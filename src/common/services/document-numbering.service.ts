import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type DocType = 'PO' | 'GRN' | 'DN' | 'INV' | 'REPL' | 'CN' | 'QTN' | 'RCPT' | 'ADJ' | 'SPAY' | 'REF';

export type FyFormat = 'YY-YY' | 'YYYY-YY' | 'YY' | 'YYYY';

// Display prefix per document type for the default (no NumberingConfig) format.
// Usually the docType code itself — except GRN, which renders as "PE" (Purchase
// Entry) to match the product naming. The internal docType key stays 'GRN' so
// the sequence counters, NumberingConfig rows, and the DocType union are
// unaffected; only the printed number string changes. Admin-defined templates
// (Settings → Numbering) carry their own prefix and override this.
const DOC_PREFIX: Record<DocType, string> = {
  PO: 'PO',
  GRN: 'PE',
  DN: 'DN',
  INV: 'INV',
  // No-charge replacement sales invoice — its own series (REPL/FY/NNNNN) so
  // replacement bills are distinguishable from regular sales at a glance.
  REPL: 'REPL',
  CN: 'CN',
  QTN: 'QTN',
  RCPT: 'RCPT',
  ADJ: 'ADJ',
  SPAY: 'SPAY',
  REF: 'REF',
};

@Injectable()
export class DocumentNumberingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Financial year helpers ───────────────────────────────────────────────
  // Indian FY runs April → March. April 2026 → fyStart=2026, fyEnd=2027.

  static getFyParts(date: Date = new Date()): { fyStart: number; fyEnd: number } {
    const month = date.getMonth();
    const year = date.getFullYear();
    const fyStart = month >= 3 ? year : year - 1;
    return { fyStart, fyEnd: fyStart + 1 };
  }

  /**
   * Canonical financial-year string used in `DocumentSequence.key` and
   * `DocumentSequence.financialYear`. Always `YY-YY` — keeps the storage key
   * stable forever, regardless of what visual `fyFormat` an admin configures.
   * Visual rendering happens separately via {@link formatFy}.
   */
  static getFinancialYear(date: Date = new Date()): string {
    const { fyStart, fyEnd } = DocumentNumberingService.getFyParts(date);
    const yy = (n: number) => String(n % 100).padStart(2, '0');
    return `${yy(fyStart)}-${yy(fyEnd)}`;
  }

  /** Render a fyStart/fyEnd pair according to the chosen format. */
  static formatFy(fyStart: number, fyEnd: number, fmt: FyFormat): string {
    const yy = (n: number) => String(n % 100).padStart(2, '0');
    switch (fmt) {
      case 'YYYY-YY': return `${fyStart}-${yy(fyEnd)}`;
      case 'YY':     return yy(fyStart);
      case 'YYYY':   return String(fyStart);
      case 'YY-YY':
      default:       return `${yy(fyStart)}-${yy(fyEnd)}`;
    }
  }

  /** Substitute `{FY}` and `{NN}` tokens in a template. Everything else is literal. */
  static applyTemplate(template: string, vars: { FY: string; NN: string }): string {
    return template.replaceAll('{FY}', vars.FY).replaceAll('{NN}', vars.NN);
  }

  // ── Main entry ───────────────────────────────────────────────────────────
  // Must be called inside a Prisma transaction so the sequence rolls back if
  // the surrounding write fails (no gaps from aborted creates).
  async nextNumber(
    tx: Prisma.TransactionClient,
    docType: DocType,
    branchId?: string | null,
  ): Promise<string> {
    const fy = DocumentNumberingService.getFinancialYear();
    const scope = branchId ?? 'GLOBAL';
    const key = `${docType}:${scope}:${fy}`;

    const seq = await tx.documentSequence.upsert({
      where: { key },
      update: { counter: { increment: 1 } },
      create: {
        key,
        docType,
        branchId: branchId ?? null,
        financialYear: fy,
        counter: 1,
      },
    });

    // Look up format config OUTSIDE the transaction — avoids unnecessary lock
    // contention and an admin update to NumberingConfig never blocks document
    // creation. If no row → fall back to the historical hardcoded format so
    // nothing breaks before admin configures anything.
    // Use findFirst (not findUnique) because the @@unique([branchId, docType])
    // includes a nullable column — Prisma's generated `findUnique` rejects
    // `branchId: null` in the composite key for that reason. findFirst still
    // returns at most one row thanks to the unique constraint.
    const config = await this.prisma.numberingConfig.findFirst({
      where: { branchId: branchId ?? null, docType },
    });

    if (!config) {
      return `${DOC_PREFIX[docType]}/${fy}/${String(seq.counter).padStart(5, '0')}`;
    }

    const { fyStart, fyEnd } = DocumentNumberingService.getFyParts();
    const renderedFy = DocumentNumberingService.formatFy(
      fyStart,
      fyEnd,
      config.fyFormat as FyFormat,
    );
    const renderedNn = String(seq.counter).padStart(config.padding, '0');
    return DocumentNumberingService.applyTemplate(config.template, {
      FY: renderedFy,
      NN: renderedNn,
    });
  }

  // ── Non-consuming preview ────────────────────────────────────────────────
  // Renders what the NEXT number WOULD be without advancing the counter — for
  // UI previews (e.g. the Sales-Return credit-note screen). Best-effort only:
  // the real number is assigned at creation time, so a concurrent create can
  // shift it. Never use the returned value as the stored number.
  async peekNextNumber(docType: DocType, branchId?: string | null): Promise<string> {
    const fy = DocumentNumberingService.getFinancialYear();
    const scope = branchId ?? 'GLOBAL';
    const key = `${docType}:${scope}:${fy}`;

    const seq = await this.prisma.documentSequence.findUnique({ where: { key } });
    const nextCounter = (seq?.counter ?? 0) + 1;

    const config = await this.prisma.numberingConfig.findFirst({
      where: { branchId: branchId ?? null, docType },
    });
    if (!config) {
      return `${DOC_PREFIX[docType]}/${fy}/${String(nextCounter).padStart(5, '0')}`;
    }
    const { fyStart, fyEnd } = DocumentNumberingService.getFyParts();
    const renderedFy = DocumentNumberingService.formatFy(
      fyStart,
      fyEnd,
      config.fyFormat as FyFormat,
    );
    const renderedNn = String(nextCounter).padStart(config.padding, '0');
    return DocumentNumberingService.applyTemplate(config.template, {
      FY: renderedFy,
      NN: renderedNn,
    });
  }

  // ── Collision defense for live (non-import) creation paths ────────────────
  // Document numbers are branch-scoped unique (see migration
  // 20260703000000_branch_scope_document_numbers), so a collision here should
  // be rare — it can only come from a live counter climbing into a number a
  // same-branch import already claimed, or a narrow concurrent-request race
  // on a brand-new (branch, docType, FY) counter row. Import services already
  // handle their own collisions with a bespoke renumber-and-retry (see
  // customer-import.service.ts / supplier-import.service.ts); this is the
  // equivalent safety net for everyday invoice/payment/GRN/etc. creation,
  // which previously had none and would surface a raw 500 on any collision.
  //
  // `operation` must run entirely inside its own transaction (or otherwise
  // leave no partial state on failure) so a retried attempt starts clean —
  // e.g. wrap an existing `this.prisma.$transaction(...)` call site as-is.
  async retryOnCollision<T>(operation: () => Promise<T>, maxRetries = 5): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await operation();
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code !== 'P2002' || attempt >= maxRetries) throw err;
        attempt++;
      }
    }
  }

  // ── Sequence resync after bulk import ─────────────────────────────────────
  // Imports write document numbers straight from the uploaded file (or the
  // legacy series) without going through nextNumber(), so the DocumentSequence
  // counters don't advance. The next LIVE create then regenerates a number an
  // import already claimed → P2002 (and retryOnCollision can't recover, since
  // the counter increment rolls back with the failed write). Call this once at
  // the end of every import commit: it walks each numbered model, extracts the
  // trailing NNNNN + FY per (docType, branch), and bumps each sequence up to the
  // highest number in use. Only ever RAISES a counter — safe to run repeatedly.
  async resyncSequences(): Promise<void> {
    const DOCS: Array<[DocType, string, string]> = [
      ['INV', 'invoice', 'invoiceNumber'],
      ['PO', 'purchaseOrder', 'poNumber'],
      ['GRN', 'gRN', 'grnNumber'],
      ['CN', 'creditNote', 'creditNoteNo'],
      ['REF', 'refund', 'refundNumber'],
      ['DN', 'purchaseReturn', 'debitNoteNo'],
      ['QTN', 'quotation', 'quotationNumber'],
      ['RCPT', 'payment', 'receiptNumber'],
      ['SPAY', 'supplierPayment', 'paymentNumber'],
    ];

    const maxByKey = new Map<
      string,
      { docType: DocType; branchId: string | null; fy: string; counter: number }
    >();

    for (const [docType, model, field] of DOCS) {
      const delegate = (this.prisma as unknown as Record<string, { findMany?: (a: unknown) => Promise<unknown> }>)[model];
      if (!delegate?.findMany) continue;
      const rows = (await delegate.findMany({
        select: { [field]: true, branchId: true },
      })) as Array<Record<string, unknown>>;
      for (const r of rows) {
        const num = r[field];
        if (typeof num !== 'string') continue;
        const parts = num.split('/');
        const suffix = parseInt(parts[parts.length - 1], 10);
        if (!Number.isFinite(suffix)) continue;
        const fy = parts.find((x) => /^\d{2}-\d{2}$/.test(x));
        if (!fy) continue;
        const branchId = (r.branchId as string | null) ?? null;
        const key = `${docType}:${branchId ?? 'GLOBAL'}:${fy}`;
        const cur = maxByKey.get(key);
        if (!cur || suffix > cur.counter) {
          maxByKey.set(key, { docType, branchId, fy, counter: suffix });
        }
      }
    }

    for (const [key, v] of maxByKey) {
      const existing = await this.prisma.documentSequence.findUnique({
        where: { key },
        select: { counter: true },
      });
      const target = Math.max(v.counter, existing?.counter ?? 0);
      if (existing && existing.counter >= target) continue; // already ahead
      await this.prisma.documentSequence.upsert({
        where: { key },
        update: { counter: target },
        create: {
          key,
          docType: v.docType,
          branchId: v.branchId,
          financialYear: v.fy,
          counter: target,
        },
      });
    }
  }
}
