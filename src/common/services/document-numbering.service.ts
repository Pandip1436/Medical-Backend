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
}
