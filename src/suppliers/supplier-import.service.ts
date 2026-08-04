import { BadRequestException, Injectable } from '@nestjs/common';
import {
  GRNStatus,
  GrnPaymentStatus,
  PaymentTerms,
  POStatus,
  Prisma,
  PurchaseReturnSettlement,
  PurchaseReturnStatus,
  SupplierActivityStatus,
  SupplierActivityType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { PartyLinkService } from '../party-link/party-link.service';
import {
  ImportBatchDto,
  ImportDebitNoteDto,
  ImportDuplicateHandling,
  ImportDuplicateMatch,
  ImportGrnDto,
  ImportPurchaseOrderDto,
  ImportResult,
  ImportRowError,
  ImportRowWarning,
  ImportSummary,
  ImportSupplierDto,
  ImportSupplierPaymentDto,
  ImportSuppliersDto,
} from './dto/import-suppliers.dto';

// Strip everything except digits — mirrors suppliers.service.normalizePhone().
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

// Last-10-digit key — same fuzzing rule as the rest of the app, so a supplier
// that exists in the DB matches an Excel row even if the operator typed the
// number with country code / spaces / hyphens.
function phoneKey(phone: string | null | undefined): string {
  return normalizePhone(phone).slice(-10);
}

function emptyResult(dryRun: boolean): ImportResult {
  return {
    dryRun,
    summary: emptySummary(),
    duplicates: [],
    errors: [],
    warnings: [],
  };
}

function emptySummary(): ImportSummary {
  return {
    suppliers: { created: 0, updated: 0, skipped: 0, failed: 0 },
    purchaseOrders: { created: 0, skipped: 0, failed: 0 },
    poItems: { created: 0 },
    grns: { created: 0, skipped: 0, failed: 0 },
    grnItems: { created: 0 },
    debitNotes: { created: 0, skipped: 0, failed: 0 },
    debitNoteItems: { created: 0 },
    payments: { created: 0, failed: 0 },
    activities: { created: 0, failed: 0 },
    batches: { created: 0, skipped: 0, failed: 0 },
    documents: { created: 0, skipped: 0, failed: 0 },
    openingBalanceApplied: 0,
  };
}

// Liberal date parser — Excel may give us Date objects, ISO strings,
// dd/mm/yyyy, dd-mm-yyyy, or Excel serial numbers (days since 1900). Identical
// behaviour to the customer-import side so the two flows are interchangeable.
function parseDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = (raw - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const iso = new Date(trimmed);
    if (!isNaN(iso.getTime())) return iso;
    const m = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]);
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      const d = new Date(year, month - 1, day);
      return isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

@Injectable()
export class SupplierImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly partyLink: PartyLinkService,
  ) {}

  // Reserve a document number in its OWN committed transaction. Used when a
  // user-provided number collides with an unrelated record elsewhere in the
  // system (see the renumber-on-collision handling in createPurchaseOrder /
  // createGrn / createDebitNote / createPayment). Calling nextNumber() inside
  // the same transaction as the record insert doesn't work for this case:
  // Postgres rolls back the WHOLE transaction — including the counter
  // increment — when the insert fails, so a retry inside that transaction
  // would regenerate the exact same (still-colliding) number forever. A
  // separate, already-committed reservation guarantees forward progress.
  private async reserveFreshNumber(
    docType: Parameters<DocumentNumberingService['nextNumber']>[1],
    branchId?: string | null,
  ): Promise<string> {
    return this.prisma.$transaction((tx) =>
      this.numbering.nextNumber(tx, docType, branchId ?? null),
    );
  }

  // Single entry point for /preview and /commit. `dryRun` toggles whether
  // we actually write. Same diagnostic shape either way so the drawer can
  // show duplicates/errors/warnings without round-trips.
  async runImport(
    dto: ImportSuppliersDto,
    ctx: { userId: string; branchId?: string | null },
  ): Promise<ImportResult> {
    if (!dto?.suppliers?.length) {
      throw new BadRequestException(
        'No suppliers provided in the import payload.',
      );
    }

    const dryRun = !!dto.dryRun;
    const result: ImportResult = emptyResult(dryRun);

    // ── Phase 1: in-payload validation (no DB) ──
    const validRows = this.validatePayload(dto.suppliers, result);
    if (validRows.length === 0) return result;

    // ── Phase 2: resolve existing suppliers by phone (1 batched query) ──
    const phoneKeys = Array.from(
      new Set(validRows.map((s) => phoneKey(s.phone)).filter(Boolean)),
    );
    const existing = await this.findExistingByPhones(phoneKeys, ctx.branchId);
    const existingByKey = new Map<
      string,
      { id: string; name: string; phone: string; branchId: string | null }
    >();
    for (const e of existing) existingByKey.set(phoneKey(e.phone), e);

    for (const s of validRows) {
      const k = phoneKey(s.phone);
      if (!k) continue;
      const e = existingByKey.get(k);
      if (!e) continue;
      result.duplicates.push({
        supplierCode: s.supplierCode,
        sourceRow: s.sourceRow ?? 0,
        action: this.actionForHandling(dto.duplicateHandling),
        existingSupplier: { id: e.id, name: e.name, phone: e.phone },
      });
    }

    if (dryRun) {
      this.simulate(validRows, existingByKey, dto.duplicateHandling, result);
      return result;
    }

    // Per-row writes. No top-level transaction (Postgres aborts the entire
    // transaction on any error — a single P2002 would poison every later row).
    // Atomicity that actually matters (numbering + insert + items) is scoped
    // to per-write mini-transactions inside the helpers.
    for (const row of validRows) {
      await this.processRow(
        row,
        existingByKey,
        dto.duplicateHandling,
        ctx,
        result,
      );
    }
    // Imported GRNs / debit notes / payments carry file-supplied numbers that
    // bypass the sequence counters — resync so live creates don't collide.
    await this.numbering.resyncSequences();
    return result;
  }

  // ── Phase 1: payload validation ───────────────────────────────────────────
  private validatePayload(
    rows: ImportSupplierDto[],
    result: ImportResult,
  ): ImportSupplierDto[] {
    const seenPhones = new Map<string, number>();
    const seenCodes = new Map<string, number>();
    const valid: ImportSupplierDto[] = [];

    for (const row of rows) {
      const src = row.sourceRow ?? 0;
      const name = (row.name ?? '').trim();
      const rawPhone = (row.phone ?? '').toString().trim();
      const last10 = phoneKey(rawPhone);

      if (!name) {
        this.pushError(result, {
          sheet: 'Suppliers',
          row: src,
          supplierCode: row.supplierCode,
          field: 'name',
          message: 'Name is required.',
        });
        result.summary.suppliers.failed++;
        continue;
      }
      if (!last10 || last10.length !== 10) {
        this.pushError(result, {
          sheet: 'Suppliers',
          row: src,
          supplierCode: row.supplierCode,
          field: 'phone',
          message: `Phone "${rawPhone}" must be a 10-digit number (extra spaces / country code OK).`,
        });
        result.summary.suppliers.failed++;
        continue;
      }
      if (seenPhones.has(last10)) {
        this.pushWarning(result, {
          kind: 'duplicate',
          sheet: 'Suppliers',
          row: src,
          supplierCode: row.supplierCode,
          field: 'phone',
          message: `Same phone appears earlier in this file at row ${seenPhones.get(last10)}. Only the first row will be imported.`,
        });
        result.summary.suppliers.skipped++;
        continue;
      }
      seenPhones.set(last10, src);

      const code = (row.supplierCode ?? '').trim();
      if (code) {
        if (seenCodes.has(code)) {
          this.pushError(result, {
            sheet: 'Suppliers',
            row: src,
            supplierCode: code,
            field: 'supplier_code',
            message: `Duplicate supplier_code "${code}" — already used at row ${seenCodes.get(code)}.`,
          });
          result.summary.suppliers.failed++;
          continue;
        }
        seenCodes.set(code, src);
      }

      valid.push(row);
    }
    return valid;
  }

  // ── Phase 2: existing-supplier lookup ─────────────────────────────────────
  private async findExistingByPhones(
    last10Keys: string[],
    branchId?: string | null,
  ) {
    if (!last10Keys.length)
      return [] as Array<{
        id: string;
        name: string;
        phone: string;
        branchId: string | null;
      }>;

    // ANDed conditions: (any phone matches) AND (branch is this-branch or
    // null). Spreading two `OR:` keys into one literal silently drops the
    // first — JS keeps only the last duplicate key — so we use an explicit
    // AND array. Same fix as customer-import.
    const where: Prisma.SupplierWhereInput = {
      AND: [
        { OR: last10Keys.map((k) => ({ phone: { contains: k } })) },
        ...(branchId ? [{ OR: [{ branchId }, { branchId: null }] }] : []),
      ],
    };
    const candidates = await this.prisma.supplier.findMany({
      where,
      select: { id: true, name: true, phone: true, branchId: true },
    });
    return candidates.filter((c) => last10Keys.includes(phoneKey(c.phone)));
  }

  // ── Phase 3a: dry-run simulation ──────────────────────────────────────────
  private simulate(
    rows: ImportSupplierDto[],
    existingByKey: Map<string, { id: string; name: string; phone: string }>,
    handling: ImportDuplicateHandling,
    result: ImportResult,
  ) {
    for (const row of rows) {
      const isDup = existingByKey.has(phoneKey(row.phone));
      if (isDup) {
        if (handling === 'SKIP') {
          result.summary.suppliers.skipped++;
          if (
            row.purchaseOrders?.length ||
            row.grns?.length ||
            row.debitNotes?.length ||
            row.payments?.length ||
            row.activities?.length ||
            row.batches?.length
          ) {
            this.pushWarning(result, {
              kind: 'duplicate',
              sheet: 'Suppliers',
              row: row.sourceRow ?? 0,
              supplierCode: row.supplierCode,
              message: `Supplier is a duplicate and you chose SKIP — its ${row.purchaseOrders?.length ?? 0} POs, ${row.grns?.length ?? 0} GRNs, ${row.debitNotes?.length ?? 0} debit notes, ${row.payments?.length ?? 0} payments, ${row.activities?.length ?? 0} activities, ${row.batches?.length ?? 0} batches will also be skipped.`,
            });
          }
          continue;
        }
        if (handling === 'UPDATE') result.summary.suppliers.updated++;
        if (handling === 'CREATE') result.summary.suppliers.created++;
      } else {
        result.summary.suppliers.created++;
      }
      result.summary.purchaseOrders.created += row.purchaseOrders?.length ?? 0;
      result.summary.poItems.created += (row.purchaseOrders ?? []).reduce(
        (s, po) => s + (po.items?.length ?? 0),
        0,
      );
      result.summary.grns.created += row.grns?.length ?? 0;
      result.summary.grnItems.created += (row.grns ?? []).reduce(
        (s, g) => s + (g.items?.length ?? 0),
        0,
      );
      result.summary.debitNotes.created += row.debitNotes?.length ?? 0;
      result.summary.debitNoteItems.created += (row.debitNotes ?? []).reduce(
        (s, d) => s + (d.items?.length ?? 0),
        0,
      );
      result.summary.payments.created += row.payments?.length ?? 0;
      result.summary.activities.created += row.activities?.length ?? 0;
      result.summary.batches.created += row.batches?.length ?? 0;
      if (typeof row.openingBalance === 'number' && row.openingBalance > 0) {
        result.summary.openingBalanceApplied += row.openingBalance;
      }

      // Surface "we'll auto-generate a number" warnings at preview time so
      // the operator can correct the workbook before commit.
      for (const po of row.purchaseOrders ?? []) {
        if (!po.poNumber?.trim()) {
          this.pushWarning(result, {
            kind: 'coerced',
            sheet: 'Purchase Orders',
            row: po.sourceRow ?? 0,
            supplierCode: row.supplierCode,
            field: 'po_number',
            message:
              'po_number is blank — a new number will be auto-generated. Fill in the legacy PO number to keep reconciliation with supplier records.',
          });
        }
      }
      for (const g of row.grns ?? []) {
        if (!g.grnNumber?.trim()) {
          this.pushWarning(result, {
            kind: 'coerced',
            sheet: 'GRNs',
            row: g.sourceRow ?? 0,
            supplierCode: row.supplierCode,
            field: 'grn_number',
            message:
              'grn_number is blank — a new number will be auto-generated.',
          });
        }
      }
      for (const d of row.debitNotes ?? []) {
        if (!d.debitNoteNo?.trim()) {
          this.pushWarning(result, {
            kind: 'coerced',
            sheet: 'Debit Notes',
            row: d.sourceRow ?? 0,
            supplierCode: row.supplierCode,
            field: 'debit_note_no',
            message:
              'debit_note_no is blank — a new number will be auto-generated.',
          });
        }
      }
      for (const p of row.payments ?? []) {
        if (!p.paymentNumber?.trim()) {
          this.pushWarning(result, {
            kind: 'coerced',
            sheet: 'Payments',
            row: p.sourceRow ?? 0,
            supplierCode: row.supplierCode,
            field: 'payment_number',
            message:
              'payment_number is blank — a new number will be auto-generated. Fill in the legacy payment reference to keep reconciliation working.',
          });
        }
      }
    }
  }

  // ── Phase 3b: real import ─────────────────────────────────────────────────
  private async processRow(
    row: ImportSupplierDto,
    existingByKey: Map<
      string,
      { id: string; name: string; phone: string; branchId: string | null }
    >,
    handling: ImportDuplicateHandling,
    ctx: { userId: string; branchId?: string | null },
    result: ImportResult,
  ): Promise<void> {
    const last10 = phoneKey(row.phone);
    const existing = existingByKey.get(last10);

    let supplierId: string;
    if (existing) {
      if (handling === 'SKIP') {
        result.summary.suppliers.skipped++;
        return;
      }
      if (handling === 'CREATE') {
        this.pushError(result, {
          sheet: 'Suppliers',
          row: row.sourceRow ?? 0,
          supplierCode: row.supplierCode,
          field: 'phone',
          message: `CREATE strategy refused: phone "${row.phone}" is already used by supplier "${existing.name}". Choose UPDATE or SKIP instead.`,
        });
        result.summary.suppliers.failed++;
        return;
      }
      // UPDATE strategy
      try {
        supplierId = existing.id;
        const updateData = this.buildSupplierUpdateData(row);

        // Branch-claim: if existing has no branch but this import is scoped,
        // attach it. UPDATE strategy explicitly opts into rewriting fields.
        if (existing.branchId === null && ctx.branchId) {
          updateData.branch = { connect: { id: ctx.branchId } };
          this.pushWarning(result, {
            kind: 'coerced',
            sheet: 'Suppliers',
            row: row.sourceRow ?? 0,
            supplierCode: row.supplierCode,
            field: 'branchId',
            message:
              "Existing supplier had no branch — claiming it to your active branch so it shows in this branch's list.",
          });
        }

        await this.prisma.supplier.update({
          where: { id: existing.id },
          data: updateData,
        });
        result.summary.suppliers.updated++;

        // Always sweep orphan history rows (branchId=null) for this supplier.
        // Prior imports may have left them stranded even if the parent is now
        // attached. Sweep is no-op when none exist.
        if (ctx.branchId) {
          await this.reclaimOrphanChildren(
            supplierId,
            ctx.branchId,
            row,
            result,
          );
        }
      } catch (err) {
        this.pushError(result, {
          sheet: 'Suppliers',
          row: row.sourceRow ?? 0,
          supplierCode: row.supplierCode,
          message: this.errMsg(err, 'Failed to update existing supplier'),
        });
        result.summary.suppliers.failed++;
        return;
      }
    } else {
      try {
        const created = await this.prisma.supplier.create({
          data: this.buildSupplierCreateData(row, ctx.branchId ?? null),
          select: { id: true },
        });
        supplierId = created.id;
        result.summary.suppliers.created++;
      } catch (err) {
        this.pushError(result, {
          sheet: 'Suppliers',
          row: row.sourceRow ?? 0,
          supplierCode: row.supplierCode,
          message: this.errMsg(err, 'Failed to create supplier'),
        });
        result.summary.suppliers.failed++;
        return;
      }
    }

    // Opening payable — set, don't add. Re-importing the same opening
    // balance shouldn't double up.
    if (typeof row.openingBalance === 'number' && row.openingBalance !== 0) {
      try {
        await this.prisma.supplier.update({
          where: { id: supplierId },
          data: {
            currentOutstanding: new Prisma.Decimal(row.openingBalance),
          },
        });
        result.summary.openingBalanceApplied += row.openingBalance;
      } catch (err) {
        this.pushError(result, {
          sheet: 'Suppliers',
          row: row.sourceRow ?? 0,
          supplierCode: row.supplierCode,
          field: 'opening_balance',
          message: this.errMsg(err, 'Failed to apply opening balance'),
        });
      }
    }

    // ── Party twin (supplier ↔ WHOLESALE customer) ──
    // A supplier is also a wholesale customer. Link this row to an existing
    // wholesale customer by GSTIN → phone (or create the twin) and sync shared
    // fields — the SAME logic the live create/edit path uses. This stops a dual
    // import (supplier list + customer list) from leaving the same party as two
    // unlinked records. Best-effort: a twin hiccup must never fail an
    // otherwise-good supplier row.
    let twinCustomerId: string | null = null;
    try {
      twinCustomerId = await this.partyLink.ensureCustomerTwin(supplierId);
    } catch (err) {
      this.pushWarning(result, {
        kind: 'missing-link',
        sheet: 'Suppliers',
        row: row.sourceRow ?? 0,
        supplierCode: row.supplierCode,
        field: 'linkedCustomer',
        message: `Supplier imported, but linking/creating its customer twin failed: ${this.errMsg(err, 'unknown error')}. Re-run the party-twin backfill to reconcile.`,
      });
    }

    // ── Documents ──
    // Uploaded files are Prescription rows on the twin customer (link in R2).
    // Re-attach each from the Documents sheet so they round-trip on export→import.
    if (twinCustomerId && row.prescriptions?.length) {
      await this.createDocuments(row, twinCustomerId, ctx.branchId ?? null, result);
    }

    // ── Purchase Orders + items ──
    for (const po of row.purchaseOrders ?? []) {
      await this.createPurchaseOrder(po, row, supplierId, ctx, result);
    }

    // ── GRNs + items ──
    // grnNumberRedirects tracks original -> actual grn_number for any GRN
    // that got renumbered on a cross-branch collision (see createGrn). A
    // debit note or payment later in this SAME row that references the
    // original number needs to resolve to what was actually stored, not the
    // number the workbook author originally wrote down.
    const grnNumberRedirects = new Map<string, string>();
    for (const g of row.grns ?? []) {
      await this.createGrn(g, row, supplierId, ctx, result, grnNumberRedirects);
    }

    // ── Debit Notes + items ──
    // Process after GRNs so a debit note that references a GRN imported in
    // the same workbook can resolve it.
    for (const d of row.debitNotes ?? []) {
      await this.createDebitNote(
        d,
        row,
        supplierId,
        ctx,
        result,
        grnNumberRedirects,
      );
    }

    // ── Payments ──
    // Process after GRNs so a payment that references a GRN imported in the
    // same workbook can resolve it.
    for (const p of row.payments ?? []) {
      await this.createPayment(
        p,
        row,
        supplierId,
        ctx,
        result,
        grnNumberRedirects,
      );
    }

    // ── Activities ──
    // App-level dedup since SupplierActivity has no unique constraint. Match
    // by (supplier, type, when, notes) — what humans treat as the "same
    // interaction." Idempotent re-imports won't double the log.
    for (const act of row.activities ?? []) {
      try {
        const resolvedOccurredAt =
          act.type === SupplierActivityType.REMINDER
            ? null
            : (parseDate(act.occurredAt) ?? new Date());
        const resolvedDueAt =
          act.type === SupplierActivityType.REMINDER
            ? parseDate(act.dueAt)
            : null;

        const existingAct = await this.prisma.supplierActivity.findFirst({
          where: {
            supplierId,
            type: act.type,
            notes: act.notes ?? null,
            ...(resolvedOccurredAt
              ? { occurredAt: resolvedOccurredAt }
              : { occurredAt: null }),
            ...(resolvedDueAt ? { dueAt: resolvedDueAt } : { dueAt: null }),
          },
          select: { id: true },
        });
        if (existingAct) {
          this.pushWarning(result, {
            kind: 'duplicate',
            sheet: 'Activities',
            row: act.sourceRow ?? 0,
            supplierCode: row.supplierCode,
            message:
              'Activity already exists for this supplier (same type / time / notes) — left untouched.',
          });
          continue;
        }

        await this.prisma.supplierActivity.create({
          data: {
            supplier: { connect: { id: supplierId } },
            createdBy: { connect: { id: ctx.userId } },
            type: act.type,
            notes: act.notes ?? null,
            title:
              act.type === SupplierActivityType.REMINDER
                ? (act.title ?? null)
                : null,
            subject:
              act.type === SupplierActivityType.EMAIL
                ? (act.subject ?? null)
                : null,
            contactName: act.contactName ?? null,
            occurredAt: resolvedOccurredAt,
            dueAt: resolvedDueAt,
            status:
              act.type === SupplierActivityType.REMINDER
                ? (act.status ?? SupplierActivityStatus.PENDING)
                : null,
            ...(ctx.branchId
              ? { branch: { connect: { id: ctx.branchId } } }
              : {}),
          },
        });
        result.summary.activities.created++;
      } catch (err) {
        this.pushError(result, {
          sheet: 'Activities',
          row: act.sourceRow ?? 0,
          supplierCode: row.supplierCode,
          message: this.errMsg(err, 'Failed to create activity'),
        });
        result.summary.activities.failed++;
      }
    }

    // ── Batches ──
    // Stock batches require a real Product.id. Resolve via productId (if
    // provided) or by exact product-name match in the active branch.
    for (const b of row.batches ?? []) {
      await this.createBatch(b, row, supplierId, ctx, result);
    }
  }

  // ── Documents → Prescription rows on the customer twin ────────────────────
  // Supplier documents physically live on the linked customer twin (file in R2,
  // link in imageUrl). Mirror the customer import: idempotent by
  // (customerId, doctorName, validUntil) so re-import doesn't duplicate.
  private async createDocuments(
    parent: ImportSupplierDto,
    customerId: string,
    branchId: string | null,
    result: ImportResult,
  ) {
    for (const doc of parent.prescriptions ?? []) {
      try {
        const validUntil = parseDate(doc.validUntil);
        const existing = await this.prisma.prescription.findFirst({
          where: {
            customerId,
            doctorName: doc.doctorName,
            ...(validUntil ? { validUntil } : { validUntil: null }),
          },
          select: { id: true },
        });
        if (existing) {
          result.summary.documents.skipped++;
          this.pushWarning(result, {
            kind: 'duplicate',
            sheet: 'Documents',
            row: doc.sourceRow ?? 0,
            supplierCode: parent.supplierCode,
            message: `Document "${doc.doctorName}" already exists for this party — left untouched.`,
          });
          continue;
        }
        await this.prisma.prescription.create({
          data: {
            customer: { connect: { id: customerId } },
            doctorName: doc.doctorName,
            notes: doc.notes ?? null,
            validUntil,
            // Preserve the R2 link on export→re-import (the file stays in R2).
            imageUrl: doc.imageUrl?.trim() || null,
            isActive: true,
            ...(branchId ? { branch: { connect: { id: branchId } } } : {}),
          },
        });
        result.summary.documents.created++;
      } catch (err) {
        result.summary.documents.failed++;
        this.pushError(result, {
          sheet: 'Documents',
          row: doc.sourceRow ?? 0,
          supplierCode: parent.supplierCode,
          message: this.errMsg(err, 'Failed to create document'),
        });
      }
    }
  }

  // ── Purchase Order creation helper ────────────────────────────────────────
  // Per-write mini-tx so numbering + PO insert + items are atomic. Retry on
  // P2002 when number was auto-generated; skip-with-warning when user-provided
  // number already exists (idempotent re-import).
  private async createPurchaseOrder(
    po: ImportPurchaseOrderDto,
    parent: ImportSupplierDto,
    supplierId: string,
    ctx: { userId: string; branchId?: string | null },
    result: ImportResult,
  ): Promise<void> {
    // 200, not 5: when a user-provided number collides with a DIFFERENT
    // branch's document (common on cross-branch migration — see
    // reserveFreshNumber), the freshly-reserved branch-local counter has to
    // climb past every number the OTHER branch already used before landing
    // on free ground. A branch with hundreds of historical documents needs a
    // correspondingly large budget; each attempt is a cheap single-row
    // reservation, so a generous cap costs little.
    const MAX_GENERATED_RETRIES = 200;
    let userProvidedNumber = po.poNumber?.trim();
    let lastErr: unknown = null;
    let renumbered = false;

    for (let attempt = 0; attempt <= MAX_GENERATED_RETRIES; attempt++) {
      try {
        const itemCount = await this.prisma.$transaction(async (tx) => {
          const poNumber =
            userProvidedNumber ||
            (await this.numbering.nextNumber(tx, 'PO', ctx.branchId ?? null));

          const supplier = await tx.supplier.findUnique({
            where: { id: supplierId },
            select: { name: true },
          });

          const status: POStatus =
            po.status && Object.values(POStatus).includes(po.status)
              ? po.status
              : POStatus.CLOSED;

          const created = await tx.purchaseOrder.create({
            data: {
              poNumber,
              date: parseDate(po.date) ?? new Date(),
              supplier: { connect: { id: supplierId } },
              supplierName: supplier?.name ?? parent.name,
              totalAmount: new Prisma.Decimal(po.totalAmount ?? 0),
              status,
              expectedDelivery: parseDate(po.expectedDelivery),
              createdBy: ctx.userId,
              ...(ctx.branchId
                ? { branch: { connect: { id: ctx.branchId } } }
                : {}),
            },
            select: { id: true },
          });

          let createdItems = 0;
          for (const item of po.items ?? []) {
            await tx.purchaseOrderItem.create({
              data: {
                purchaseOrder: { connect: { id: created.id } },
                productId: '', // historical import — no live Product linkage
                productName: item.productName ?? 'Imported item',
                requiredQty: Math.trunc(item.requiredQty ?? 0),
                lastPurchaseRate: new Prisma.Decimal(
                  item.lastPurchaseRate ?? 0,
                ),
                expectedRate: new Prisma.Decimal(item.expectedRate ?? 0),
                receivedQty: Math.trunc(item.receivedQty ?? 0),
                remarks: item.remarks ?? null,
              },
            });
            createdItems++;
          }
          return createdItems;
        });

        result.summary.purchaseOrders.created++;
        result.summary.poItems.created += itemCount;
        return;
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string })?.code;
        if (code === 'P2002') {
          if (!userProvidedNumber) continue;
          const existing = await this.prisma.purchaseOrder.findFirst({
            where: { supplierId, poNumber: userProvidedNumber },
            select: { id: true },
          });
          if (existing) {
            this.pushWarning(result, {
              kind: 'duplicate',
              sheet: 'Purchase Orders',
              row: po.sourceRow ?? 0,
              supplierCode: parent.supplierCode,
              field: 'po_number',
              message: `PO ${userProvidedNumber} already exists — leaving the existing record alone (no duplicate created).`,
            });
            result.summary.purchaseOrders.skipped++;
            return;
          }
          // po_number is globally unique in the schema but historical numbers
          // are only unique within the source branch — this collides with an
          // unrelated PO elsewhere in the system. Renumber instead of
          // silently dropping the record.
          if (!renumbered) {
            this.pushWarning(result, {
              kind: 'coerced',
              sheet: 'Purchase Orders',
              row: po.sourceRow ?? 0,
              supplierCode: parent.supplierCode,
              field: 'po_number',
              message: `PO number "${userProvidedNumber}" is already used elsewhere in the system (different supplier/branch) — a new number was generated so this PO isn't lost.`,
            });
            renumbered = true;
          }
          userProvidedNumber = await this.reserveFreshNumber(
            'PO',
            ctx.branchId,
          );
          continue;
        }
        break;
      }
    }
    this.pushError(result, {
      sheet: 'Purchase Orders',
      row: po.sourceRow ?? 0,
      supplierCode: parent.supplierCode,
      message: this.errMsg(lastErr, 'Failed to create purchase order'),
    });
    result.summary.purchaseOrders.failed++;
  }

  // ── GRN creation helper ───────────────────────────────────────────────────
  private async createGrn(
    g: ImportGrnDto,
    parent: ImportSupplierDto,
    supplierId: string,
    ctx: { userId: string; branchId?: string | null },
    result: ImportResult,
    grnNumberRedirects: Map<string, string>,
  ): Promise<void> {
    if (!g.supplierInvoiceNo?.trim()) {
      this.pushError(result, {
        sheet: 'GRNs',
        row: g.sourceRow ?? 0,
        supplierCode: parent.supplierCode,
        field: 'supplier_invoice_no',
        message:
          "supplier_invoice_no is required on a GRN — that's the supplier's bill number we're recording goods against.",
      });
      result.summary.grns.failed++;
      return;
    }

    // Idempotency check by real-world identity, not grn_number: a re-import
    // of the same workbook (e.g. retrying after a partial failure) must not
    // create a second GRN for a bill we already recorded. grn_number is a
    // poor dedup key here — a GRN that collided cross-branch on a prior run
    // was renumbered (see below), so its stored grn_number no longer matches
    // the sheet's original value. supplier_invoice_no is the supplier's own
    // bill number and is never renumbered, so it's the reliable key.
    const existingByInvoice = await this.prisma.gRN.findFirst({
      where: { supplierId, supplierInvoiceNo: g.supplierInvoiceNo.trim() },
      select: { id: true, grnNumber: true },
    });
    if (existingByInvoice) {
      this.pushWarning(result, {
        kind: 'duplicate',
        sheet: 'GRNs',
        row: g.sourceRow ?? 0,
        supplierCode: parent.supplierCode,
        field: 'supplier_invoice_no',
        message: `A GRN for supplier invoice "${g.supplierInvoiceNo.trim()}" already exists for this supplier — leaving the existing record alone (no duplicate created).`,
      });
      result.summary.grns.skipped++;
      // Even on skip, redirect debit notes / payments in this row that
      // reference the sheet's original grn_number to the actual stored
      // number — it may have been renumbered on the run that first created
      // this GRN.
      const sheetNumber = g.grnNumber?.trim();
      if (sheetNumber && sheetNumber !== existingByInvoice.grnNumber) {
        grnNumberRedirects.set(sheetNumber, existingByInvoice.grnNumber);
      }
      return;
    }

    // 200, not 5: when a user-provided number collides with a DIFFERENT
    // branch's document (common on cross-branch migration — see
    // reserveFreshNumber), the freshly-reserved branch-local counter has to
    // climb past every number the OTHER branch already used before landing
    // on free ground. A branch with hundreds of historical documents needs a
    // correspondingly large budget; each attempt is a cheap single-row
    // reservation, so a generous cap costs little.
    const MAX_GENERATED_RETRIES = 200;
    const originalNumber = g.grnNumber?.trim();
    let userProvidedNumber = originalNumber;
    let lastErr: unknown = null;
    let renumbered = false;
    let actualGrnNumber = '';

    for (let attempt = 0; attempt <= MAX_GENERATED_RETRIES; attempt++) {
      try {
        const itemCount = await this.prisma.$transaction(async (tx) => {
          const grnNumber =
            userProvidedNumber ||
            (await this.numbering.nextNumber(tx, 'GRN', ctx.branchId ?? null));
          actualGrnNumber = grnNumber;

          const supplier = await tx.supplier.findUnique({
            where: { id: supplierId },
            select: { name: true },
          });

          const status: GRNStatus =
            g.status && Object.values(GRNStatus).includes(g.status)
              ? g.status
              : GRNStatus.VERIFIED;

          // Round-trip the paid side: clamp amount_paid to [0, invoice] and
          // derive the GRN's payment status from it, so the supplier's Paid /
          // Outstanding read back exactly as exported (the live read sums
          // GRN.amountPaid). Replacement GRNs are money-neutral → stay unpaid.
          const invoiceAmount = Number(g.supplierInvoiceAmount ?? g.totalAmount ?? 0);
          const amountPaid = g.isReplacement
            ? 0
            : Math.min(Math.max(Number(g.amountPaid ?? 0), 0), invoiceAmount);
          const paymentStatus: GrnPaymentStatus =
            invoiceAmount <= 0 || amountPaid >= invoiceAmount - 0.01
              ? GrnPaymentStatus.PAID
              : amountPaid <= 0.01
                ? GrnPaymentStatus.UNPAID
                : GrnPaymentStatus.PARTIAL;

          const created = await tx.gRN.create({
            data: {
              grnNumber,
              date: parseDate(g.date) ?? new Date(),
              supplier: { connect: { id: supplierId } },
              supplierName: supplier?.name ?? parent.name,
              supplierInvoiceNo: g.supplierInvoiceNo.trim(),
              supplierInvoiceDate:
                parseDate(g.supplierInvoiceDate) ?? new Date(),
              supplierInvoiceAmount: new Prisma.Decimal(
                g.supplierInvoiceAmount ?? g.totalAmount ?? 0,
              ),
              amountPaid: new Prisma.Decimal(amountPaid),
              paymentStatus,
              totalAmount: new Prisma.Decimal(g.totalAmount ?? 0),
              status,
              isReplacement: g.isReplacement ?? false,
              ...(ctx.branchId
                ? { branch: { connect: { id: ctx.branchId } } }
                : {}),
            },
            select: { id: true },
          });

          let createdItems = 0;
          for (const item of g.items ?? []) {
            const productId = await this.resolveProductId(
              tx,
              item.productName,
              ctx.branchId,
            );
            if (!productId && item.productName?.trim()) {
              this.pushWarning(result, {
                kind: 'missing-link',
                sheet: 'GRN Items',
                row: g.sourceRow ?? 0,
                supplierCode: parent.supplierCode,
                field: 'product_name',
                message: `Product "${item.productName}" not found — this GRN still imports (for the ledger), but no stock batch was created and it won't appear in that product's history.`,
              });
            }

            const receivedQty = Math.trunc(item.receivedQty ?? 0);
            const freeQty = Math.trunc(item.freeQty ?? 0);
            const mfgDate = parseDate(item.mfgDate) ?? null;
            const expiryDate = parseDate(item.expiryDate) ?? new Date();
            const purchaseRate = new Prisma.Decimal(item.purchaseRate ?? 0);
            const mrp = new Prisma.Decimal(item.mrp ?? 0);

            const grnItem = await tx.gRNItem.create({
              data: {
                grn: { connect: { id: created.id } },
                productId,
                productName: item.productName ?? 'Imported item',
                orderedQty: Math.trunc(item.orderedQty ?? receivedQty),
                receivedQty,
                freeQty,
                batchNumber: item.batchNumber ?? '',
                mfgDate,
                expiryDate,
                purchaseRate,
                mrp,
                damageQty: Math.trunc(item.damageQty ?? 0),
              },
            });
            createdItems++;

            // Mirror the live GRN-receiving flow (grn.service.ts applyGrnItems)
            // so an imported purchase becomes real, sellable stock — not just
            // a financial record. Only when we resolved a real product; a GRN
            // for an unmatched product still imports for the ledger, but with
            // no stock movement (nothing to attach a batch to).
            const addedStock = receivedQty + freeQty;
            if (productId && addedStock > 0) {
              await tx.batch.create({
                data: {
                  productId,
                  batchNumber: item.batchNumber ?? '',
                  mfgDate,
                  expiryDate,
                  quantity: addedStock,
                  mrp,
                  purchaseRate,
                  supplierId,
                  grnItemId: grnItem.id,
                },
              });
              await tx.product.update({
                where: { id: productId },
                data: { totalStock: { increment: addedStock } },
              });
            }
          }
          return createdItems;
        });

        result.summary.grns.created++;
        result.summary.grnItems.created += itemCount;
        if (originalNumber && actualGrnNumber !== originalNumber) {
          grnNumberRedirects.set(originalNumber, actualGrnNumber);
        }
        return;
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string })?.code;
        if (code === 'P2002') {
          if (!userProvidedNumber) continue;
          const existing = await this.prisma.gRN.findFirst({
            where: { supplierId, grnNumber: userProvidedNumber },
            select: { id: true },
          });
          if (existing) {
            this.pushWarning(result, {
              kind: 'duplicate',
              sheet: 'GRNs',
              row: g.sourceRow ?? 0,
              supplierCode: parent.supplierCode,
              field: 'grn_number',
              message: `GRN ${userProvidedNumber} already exists — leaving the existing record alone (no duplicate created).`,
            });
            result.summary.grns.skipped++;
            return;
          }
          // grn_number is globally unique in the schema but historical numbers
          // are only unique within the source branch — this collides with an
          // unrelated GRN elsewhere in the system. Renumber instead of
          // silently dropping the record.
          if (!renumbered) {
            this.pushWarning(result, {
              kind: 'coerced',
              sheet: 'GRNs',
              row: g.sourceRow ?? 0,
              supplierCode: parent.supplierCode,
              field: 'grn_number',
              message: `GRN number "${userProvidedNumber}" is already used elsewhere in the system (different supplier/branch) — a new number was generated so this GRN isn't lost.`,
            });
            renumbered = true;
          }
          userProvidedNumber = await this.reserveFreshNumber(
            'GRN',
            ctx.branchId,
          );
          continue;
        }
        break;
      }
    }
    this.pushError(result, {
      sheet: 'GRNs',
      row: g.sourceRow ?? 0,
      supplierCode: parent.supplierCode,
      message: this.errMsg(lastErr, 'Failed to create GRN'),
    });
    result.summary.grns.failed++;
  }

  // ── Debit Note creation helper ────────────────────────────────────────────
  // Optional parent GRN: if grnNumber is supplied, look it up by
  // (supplierId, grnNumber). Emit a clear error if not found — better than a
  // generic FK violation.
  private async createDebitNote(
    d: ImportDebitNoteDto,
    parent: ImportSupplierDto,
    supplierId: string,
    ctx: { userId: string; branchId?: string | null },
    result: ImportResult,
    grnNumberRedirects: Map<string, string>,
  ): Promise<void> {
    let grnId: string | null = null;
    const grnNumber = d.grnNumber?.trim();
    if (grnNumber) {
      // The referenced GRN may have been renumbered earlier in this same
      // import run (see createGrn's cross-branch renumbering) — resolve
      // through the redirect map before falling back to the raw sheet value.
      const resolvedGrnNumber = grnNumberRedirects.get(grnNumber) ?? grnNumber;
      const parentGrn = await this.prisma.gRN.findFirst({
        where: { supplierId, grnNumber: resolvedGrnNumber },
        select: { id: true },
      });
      if (!parentGrn) {
        this.pushError(result, {
          sheet: 'Debit Notes',
          row: d.sourceRow ?? 0,
          supplierCode: parent.supplierCode,
          field: 'grn_number',
          message: `GRN "${grnNumber}" not found for this supplier. Import the parent GRN first, or correct the grn_number, or leave blank to skip the link.`,
        });
        result.summary.debitNotes.failed++;
        return;
      }
      grnId = parentGrn.id;
    }

    // 200, not 5: when a user-provided number collides with a DIFFERENT
    // branch's document (common on cross-branch migration — see
    // reserveFreshNumber), the freshly-reserved branch-local counter has to
    // climb past every number the OTHER branch already used before landing
    // on free ground. A branch with hundreds of historical documents needs a
    // correspondingly large budget; each attempt is a cheap single-row
    // reservation, so a generous cap costs little.
    const MAX_GENERATED_RETRIES = 200;
    let userProvidedNumber = d.debitNoteNo?.trim();
    let lastErr: unknown = null;
    let renumbered = false;

    for (let attempt = 0; attempt <= MAX_GENERATED_RETRIES; attempt++) {
      try {
        const itemCount = await this.prisma.$transaction(async (tx) => {
          const debitNoteNo =
            userProvidedNumber ||
            (await this.numbering.nextNumber(tx, 'DN', ctx.branchId ?? null));

          const supplier = await tx.supplier.findUnique({
            where: { id: supplierId },
            select: { name: true },
          });

          const status: PurchaseReturnStatus =
            d.status && Object.values(PurchaseReturnStatus).includes(d.status)
              ? d.status
              : PurchaseReturnStatus.SETTLED;
          const settlementMode: PurchaseReturnSettlement =
            d.settlementMode &&
            Object.values(PurchaseReturnSettlement).includes(d.settlementMode)
              ? d.settlementMode
              : PurchaseReturnSettlement.REFUND;

          const created = await tx.purchaseReturn.create({
            data: {
              debitNoteNo,
              date: parseDate(d.date) ?? new Date(),
              // The ledger orders returns by createdAt, so stamp it with the
              // historical date too — otherwise imported returns all sort by
              // import time and lose their original sequence.
              createdAt: parseDate(d.date) ?? new Date(),
              supplier: { connect: { id: supplierId } },
              supplierName: supplier?.name ?? parent.name,
              reason: d.reason ?? 'Imported debit note',
              subtotal: new Prisma.Decimal(d.subtotal ?? 0),
              cgst: new Prisma.Decimal(d.cgst ?? 0),
              sgst: new Prisma.Decimal(d.sgst ?? 0),
              igst: new Prisma.Decimal(d.igst ?? 0),
              totalAmount: new Prisma.Decimal(d.totalAmount ?? 0),
              status,
              settlementMode,
              notes: d.notes ?? null,
              createdById: ctx.userId,
              ...(grnId ? { grn: { connect: { id: grnId } } } : {}),
              ...(ctx.branchId
                ? { branch: { connect: { id: ctx.branchId } } }
                : {}),
            },
            select: { id: true },
          });

          // Short delivery = goods never arrived, so nothing to deduct from
          // stock. Every other reason means physical goods went back to the
          // supplier. Mirrors purchase-returns.service.ts create().
          const isShortDelivery = /short.*delivery|short.*supply/i.test(
            d.reason ?? '',
          );

          let createdItems = 0;
          for (const item of d.items ?? []) {
            const productId = await this.resolveProductId(
              tx,
              item.productName,
              ctx.branchId,
            );
            if (!productId && item.productName?.trim()) {
              this.pushWarning(result, {
                kind: 'missing-link',
                sheet: 'Debit Note Items',
                row: d.sourceRow ?? 0,
                supplierCode: parent.supplierCode,
                field: 'product_name',
                message: `Product "${item.productName}" not found — this line won't appear in that product's history (the debit note itself still imports fine). No stock can be adjusted for an unmatched product.`,
              });
            }
            const returnedQty = Math.trunc(item.returnedQty ?? 0);
            await tx.purchaseReturnItem.create({
              data: {
                purchaseReturn: { connect: { id: created.id } },
                productId,
                productName: item.productName ?? 'Imported item',
                batchId: '',
                batchNumber: item.batchNumber ?? '',
                expiryDate: parseDate(item.expiryDate) ?? new Date(),
                returnedQty,
                purchaseRate: new Prisma.Decimal(item.purchaseRate ?? 0),
                gstPercent: new Prisma.Decimal(item.gstPercent ?? 0),
                amount: new Prisma.Decimal(item.amount ?? 0),
              },
            });
            createdItems++;

            // Deduct returned goods from the GRN-created batch, matching the
            // live purchase-return flow so imported stock isn't left gross of
            // returns (the batch was created at GRN received qty earlier in
            // this import — GRNs run before debit notes). Conservative: only
            // when the batch is unambiguous (exactly one GRN-linked batch for
            // this product+number) and holds enough stock, so the import can't
            // fail or drive a batch negative on a polluted/replacement note.
            if (!isShortDelivery && productId && returnedQty > 0) {
              const matches = await tx.batch.findMany({
                where: {
                  productId,
                  batchNumber: item.batchNumber ?? '',
                  grnItemId: { not: null },
                },
                select: { id: true, quantity: true },
              });
              if (matches.length === 1 && matches[0].quantity >= returnedQty) {
                await tx.batch.update({
                  where: { id: matches[0].id },
                  data: { quantity: { decrement: returnedQty } },
                });
                await tx.product.update({
                  where: { id: productId },
                  data: { totalStock: { decrement: returnedQty } },
                });
              }
            }
          }
          return createdItems;
        });

        result.summary.debitNotes.created++;
        result.summary.debitNoteItems.created += itemCount;
        return;
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string })?.code;
        if (code === 'P2002') {
          if (!userProvidedNumber) continue;
          const existing = await this.prisma.purchaseReturn.findFirst({
            where: { supplierId, debitNoteNo: userProvidedNumber },
            select: { id: true },
          });
          if (existing) {
            this.pushWarning(result, {
              kind: 'duplicate',
              sheet: 'Debit Notes',
              row: d.sourceRow ?? 0,
              supplierCode: parent.supplierCode,
              field: 'debit_note_no',
              message: `Debit note ${userProvidedNumber} already exists — leaving the existing record alone (no duplicate created).`,
            });
            result.summary.debitNotes.skipped++;
            return;
          }
          // debit_note_no is globally unique in the schema but historical
          // numbers are only unique within the source branch — this collides
          // with an unrelated debit note elsewhere in the system. Renumber
          // instead of silently dropping the record.
          if (!renumbered) {
            this.pushWarning(result, {
              kind: 'coerced',
              sheet: 'Debit Notes',
              row: d.sourceRow ?? 0,
              supplierCode: parent.supplierCode,
              field: 'debit_note_no',
              message: `Debit note number "${userProvidedNumber}" is already used elsewhere in the system (different supplier/branch) — a new number was generated so this debit note isn't lost.`,
            });
            renumbered = true;
          }
          userProvidedNumber = await this.reserveFreshNumber(
            'DN',
            ctx.branchId,
          );
          continue;
        }
        break;
      }
    }
    this.pushError(result, {
      sheet: 'Debit Notes',
      row: d.sourceRow ?? 0,
      supplierCode: parent.supplierCode,
      message: this.errMsg(lastErr, 'Failed to create debit note'),
    });
    result.summary.debitNotes.failed++;
  }

  // ── Payment creation helper ───────────────────────────────────────────────
  // Same retry-on-generated-collision pattern as createPurchaseOrder/createGrn.
  //
  // Imported payments are historical records, not a live collection event —
  // they don't decrement Supplier.currentOutstanding (that's set once via
  // opening_balance, same reasoning as the customer-import side).
  private async createPayment(
    p: ImportSupplierPaymentDto,
    parent: ImportSupplierDto,
    supplierId: string,
    ctx: { userId: string; branchId?: string | null },
    result: ImportResult,
    grnNumberRedirects: Map<string, string>,
  ): Promise<void> {
    const amount = Number(p.amount);
    if (!(amount > 0)) {
      this.pushError(result, {
        sheet: 'Payments',
        row: p.sourceRow ?? 0,
        supplierCode: parent.supplierCode,
        field: 'amount',
        message: 'Payment amount must be greater than zero.',
      });
      result.summary.payments.failed++;
      return;
    }

    let grnId: string | null = null;
    const grnNumber = p.grnNumber?.trim();
    if (grnNumber) {
      // The referenced GRN may have been renumbered earlier in this same
      // import run (see createGrn's cross-branch renumbering) — resolve
      // through the redirect map before falling back to the raw sheet value.
      const resolvedGrnNumber = grnNumberRedirects.get(grnNumber) ?? grnNumber;
      const parentGrn = await this.prisma.gRN.findFirst({
        where: { supplierId, grnNumber: resolvedGrnNumber },
        select: { id: true },
      });
      if (!parentGrn) {
        this.pushError(result, {
          sheet: 'Payments',
          row: p.sourceRow ?? 0,
          supplierCode: parent.supplierCode,
          field: 'grn_number',
          message: `GRN "${grnNumber}" not found for this supplier. Import the parent GRN first, correct the grn_number, or leave blank for a lump-sum payment.`,
        });
        result.summary.payments.failed++;
        return;
      }
      grnId = parentGrn.id;
    }

    // 200, not 5: when a user-provided number collides with a DIFFERENT
    // branch's document (common on cross-branch migration — see
    // reserveFreshNumber), the freshly-reserved branch-local counter has to
    // climb past every number the OTHER branch already used before landing
    // on free ground. A branch with hundreds of historical documents needs a
    // correspondingly large budget; each attempt is a cheap single-row
    // reservation, so a generous cap costs little.
    const MAX_GENERATED_RETRIES = 200;
    let userProvidedNumber = p.paymentNumber?.trim();
    let lastErr: unknown = null;
    let renumbered = false;

    for (let attempt = 0; attempt <= MAX_GENERATED_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const paymentNumber =
            userProvidedNumber ||
            (await this.numbering.nextNumber(
              tx,
              'SPAY',
              ctx.branchId ?? null,
            ));

          await tx.supplierPayment.create({
            data: {
              paymentNumber,
              supplier: { connect: { id: supplierId } },
              ...(grnId ? { grn: { connect: { id: grnId } } } : {}),
              amount: new Prisma.Decimal(amount),
              paymentMode: p.paymentMode ?? 'CASH',
              referenceNumber: p.referenceNumber ?? null,
              notes: p.notes ?? null,
              // The ledger orders payments by createdAt — stamp it with the
              // historical date so imported payments keep their sequence
              // instead of all sorting by import time.
              createdAt: parseDate(p.date) ?? new Date(),
              ...(ctx.branchId
                ? { branch: { connect: { id: ctx.branchId } } }
                : {}),
            },
          });
        });
        result.summary.payments.created++;
        return;
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string })?.code;
        if (code === 'P2002') {
          if (!userProvidedNumber) continue;
          const existing = await this.prisma.supplierPayment.findFirst({
            where: { supplierId, paymentNumber: userProvidedNumber },
            select: { id: true },
          });
          if (existing) {
            this.pushWarning(result, {
              kind: 'duplicate',
              sheet: 'Payments',
              row: p.sourceRow ?? 0,
              supplierCode: parent.supplierCode,
              field: 'payment_number',
              message: `Payment ${userProvidedNumber} already exists — leaving the existing record alone (no duplicate created).`,
            });
            return;
          }
          // payment_number is globally unique in the schema but historical
          // numbers are only unique within the source branch — this collides
          // with an unrelated payment elsewhere in the system. Renumber
          // instead of silently dropping the record.
          if (!renumbered) {
            this.pushWarning(result, {
              kind: 'coerced',
              sheet: 'Payments',
              row: p.sourceRow ?? 0,
              supplierCode: parent.supplierCode,
              field: 'payment_number',
              message: `Payment number "${userProvidedNumber}" is already used elsewhere in the system (different supplier/branch) — a new number was generated so this payment isn't lost.`,
            });
            renumbered = true;
          }
          userProvidedNumber = await this.reserveFreshNumber(
            'SPAY',
            ctx.branchId,
          );
          continue;
        }
        break;
      }
    }
    this.pushError(result, {
      sheet: 'Payments',
      row: p.sourceRow ?? 0,
      supplierCode: parent.supplierCode,
      message: this.errMsg(lastErr, 'Failed to create payment'),
    });
    result.summary.payments.failed++;
  }

  // ── Batch creation helper ────────────────────────────────────────────────
  // Batch has no @unique constraint; dedup is app-level on
  // (supplierId, productId, batchNumber) — what humans treat as "the same
  // physical stock batch from the same supplier."
  //
  // Batch.productId is a REQUIRED FK to a real Product row. Two ways to
  // resolve it from the workbook:
  //   1. productId provided directly — use as-is (we verify it exists)
  //   2. productName provided — case-insensitive exact match within the
  //      active branch. Fail-fast with a helpful error otherwise.
  //
  // Batch has no branchId in the schema, so no orphan-reclaim sweep needed.
  private async createBatch(
    b: ImportBatchDto,
    parent: ImportSupplierDto,
    supplierId: string,
    ctx: { userId: string; branchId?: string | null },
    result: ImportResult,
  ): Promise<void> {
    void ctx; // ctx reserved for future use (e.g. audit logging)

    const batchNumber = b.batchNumber?.trim();
    if (!batchNumber) {
      this.pushError(result, {
        sheet: 'Batches',
        row: b.sourceRow ?? 0,
        supplierCode: parent.supplierCode,
        field: 'batch_number',
        message: 'batch_number is required.',
      });
      result.summary.batches.failed++;
      return;
    }

    // Resolve Product.id. product_id is a raw live row id — trustworthy for
    // a same-branch round-trip re-import, but an export from a DIFFERENT
    // branch (e.g. cross-branch migration) can carry a product_id that
    // exists but belongs to the wrong branch. Verify branch scope and fall
    // back to a name-based lookup rather than silently attaching stock to
    // another branch's product.
    let productId = b.productId?.trim();
    if (productId) {
      const exists = await this.prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, branchId: true },
      });
      if (!exists) {
        this.pushError(result, {
          sheet: 'Batches',
          row: b.sourceRow ?? 0,
          supplierCode: parent.supplierCode,
          field: 'product_id',
          message: `product_id "${productId}" not found.`,
        });
        result.summary.batches.failed++;
        return;
      }
      if (ctx.branchId && exists.branchId && exists.branchId !== ctx.branchId) {
        productId = undefined;
        this.pushWarning(result, {
          kind: 'missing-link',
          sheet: 'Batches',
          row: b.sourceRow ?? 0,
          supplierCode: parent.supplierCode,
          field: 'product_id',
          message: `product_id "${b.productId}" belongs to a different branch — ignoring it and matching by product_name in this branch instead.`,
        });
      }
    }
    if (!productId) {
      const productName = b.productName?.trim();
      if (!productName) {
        this.pushError(result, {
          sheet: 'Batches',
          row: b.sourceRow ?? 0,
          supplierCode: parent.supplierCode,
          field: 'product_name',
          message: 'Either product_id or product_name is required.',
        });
        result.summary.batches.failed++;
        return;
      }
      // Case-insensitive name match scoped to branch (or global if branch
      // unset). Strict equals on the name field — fuzzy matching would
      // silently link batches to the wrong product.
      const candidate = await this.prisma.product.findFirst({
        where: {
          name: { equals: productName, mode: 'insensitive' },
          ...(ctx.branchId
            ? { OR: [{ branchId: ctx.branchId }, { branchId: null }] }
            : {}),
        },
        select: { id: true },
      });
      if (!candidate) {
        this.pushError(result, {
          sheet: 'Batches',
          row: b.sourceRow ?? 0,
          supplierCode: parent.supplierCode,
          field: 'product_name',
          message: `Product "${productName}" not found in this branch. Create the product first, or provide product_id directly.`,
        });
        result.summary.batches.failed++;
        return;
      }
      productId = candidate.id;
    }

    // App-level dedup — same supplier + same product + same batchNumber.
    const existing = await this.prisma.batch.findFirst({
      where: { supplierId, productId, batchNumber },
      select: { id: true },
    });
    if (existing) {
      this.pushWarning(result, {
        kind: 'duplicate',
        sheet: 'Batches',
        row: b.sourceRow ?? 0,
        supplierCode: parent.supplierCode,
        field: 'batch_number',
        message: `Batch "${batchNumber}" already exists for this supplier+product — left untouched.`,
      });
      result.summary.batches.skipped++;
      return;
    }

    try {
      await this.prisma.batch.create({
        data: {
          product: { connect: { id: productId } },
          supplier: { connect: { id: supplierId } },
          batchNumber,
          mfgDate: parseDate(b.mfgDate) ?? new Date(),
          expiryDate: parseDate(b.expiryDate) ?? new Date(),
          quantity: Math.trunc(b.quantity ?? 0),
          mrp: new Prisma.Decimal(b.mrp ?? 0),
          purchaseRate: new Prisma.Decimal(b.purchaseRate ?? 0),
        },
      });
      result.summary.batches.created++;
    } catch (err) {
      this.pushError(result, {
        sheet: 'Batches',
        row: b.sourceRow ?? 0,
        supplierCode: parent.supplierCode,
        message: this.errMsg(err, 'Failed to create batch'),
      });
      result.summary.batches.failed++;
    }
  }

  // ── Orphan-child reclaim ─────────────────────────────────────────────────
  // When a supplier is claimed to a branch via UPDATE, sweep any of their
  // child rows still sitting in `branchId = null` onto the same branch.
  // Mirror of customer-side helper.
  private async reclaimOrphanChildren(
    supplierId: string,
    branchId: string,
    row: ImportSupplierDto,
    result: ImportResult,
  ): Promise<void> {
    const [po, grn, dn, pay, act] = await Promise.all([
      this.prisma.purchaseOrder.updateMany({
        where: { supplierId, branchId: null },
        data: { branchId },
      }),
      this.prisma.gRN.updateMany({
        where: { supplierId, branchId: null },
        data: { branchId },
      }),
      this.prisma.purchaseReturn.updateMany({
        where: { supplierId, branchId: null },
        data: { branchId },
      }),
      this.prisma.supplierPayment.updateMany({
        where: { supplierId, branchId: null },
        data: { branchId },
      }),
      this.prisma.supplierActivity.updateMany({
        where: { supplierId, branchId: null },
        data: { branchId },
      }),
    ]);
    const totalMoved = po.count + grn.count + dn.count + pay.count + act.count;
    if (totalMoved > 0) {
      this.pushWarning(result, {
        kind: 'coerced',
        sheet: 'Suppliers',
        row: row.sourceRow ?? 0,
        supplierCode: row.supplierCode,
        field: 'branchId',
        message: `Reclaimed ${po.count} orphan PO(s), ${grn.count} GRN(s), ${dn.count} debit note(s), ${pay.count} payment(s), ${act.count} activity(ies) onto your active branch.`,
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildSupplierCreateData(
    row: ImportSupplierDto,
    branchId: string | null,
  ): Prisma.SupplierCreateInput {
    // Supplier base fields are REQUIRED at the Prisma layer. For sparse
    // legacy data we default missing strings to '' so the import doesn't
    // block — admin can clean up via the form post-import.
    return {
      name: row.name.trim(),
      phone: normalizePhone(row.phone),
      contactPerson: row.contactPerson?.trim() || '',
      email: row.email?.trim() || '',
      gstin: row.gstin?.trim() || '',
      drugLicense: row.drugLicense?.trim() || '',
      address: row.address?.trim() || '',
      paymentTerms: row.paymentTerms ?? PaymentTerms.NET_30,
      bankDetails: row.bankDetails?.trim() || null,
      bankAccountName: row.bankAccountName?.trim() || null,
      bankName: row.bankName?.trim() || null,
      bankAccountNumber: row.bankAccountNumber?.trim() || null,
      bankIfsc: row.bankIfsc?.trim() || null,
      bankUpiId: row.bankUpiId?.trim() || null,
      alternatePhone: row.alternatePhone?.trim() || null,
      notes: row.notes?.trim() || null,
      isActive: row.isActive ?? true,
      currentOutstanding: new Prisma.Decimal(0), // overwritten by opening_balance pass
      ...(branchId ? { branch: { connect: { id: branchId } } } : {}),
    };
  }

  private buildSupplierUpdateData(
    row: ImportSupplierDto,
  ): Prisma.SupplierUpdateInput {
    // UPDATE rewrites mutable fields. We do NOT touch phone (it's the match
    // key) or currentOutstanding (handled via opening_balance) to avoid
    // surprising side effects.
    const data: Prisma.SupplierUpdateInput = {};
    if (row.name?.trim()) data.name = row.name.trim();
    if (row.contactPerson !== undefined)
      data.contactPerson = row.contactPerson?.trim() || '';
    if (row.email !== undefined) data.email = row.email?.trim() || '';
    if (row.gstin !== undefined) data.gstin = row.gstin?.trim() || '';
    if (row.drugLicense !== undefined)
      data.drugLicense = row.drugLicense?.trim() || '';
    if (row.address !== undefined) data.address = row.address?.trim() || '';
    if (row.paymentTerms !== undefined) data.paymentTerms = row.paymentTerms;
    if (row.bankDetails !== undefined)
      data.bankDetails = row.bankDetails?.trim() || null;
    if (row.bankAccountName !== undefined) data.bankAccountName = row.bankAccountName?.trim() || null;
    if (row.bankName !== undefined) data.bankName = row.bankName?.trim() || null;
    if (row.bankAccountNumber !== undefined) data.bankAccountNumber = row.bankAccountNumber?.trim() || null;
    if (row.bankIfsc !== undefined) data.bankIfsc = row.bankIfsc?.trim() || null;
    if (row.bankUpiId !== undefined) data.bankUpiId = row.bankUpiId?.trim() || null;
    if (row.alternatePhone !== undefined) data.alternatePhone = row.alternatePhone?.trim() || null;
    if (row.notes !== undefined) data.notes = row.notes?.trim() || null;
    if (row.isActive !== undefined) data.isActive = row.isActive;
    return data;
  }

  // Best-effort link to a real Product by name (case-insensitive, scoped to
  // branch or global) — same lookup pattern createBatch() below already uses.
  // Returns '' (unchanged historical behaviour) when there's no match, so a
  // typo'd/discontinued product name doesn't fail the whole row — it just
  // won't show in that product's history.
  private async resolveProductId(
    tx: Prisma.TransactionClient,
    productName: string | undefined,
    branchId: string | null | undefined,
  ): Promise<string> {
    const name = productName?.trim();
    if (!name) return '';
    const candidate = await tx.product.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      },
      select: { id: true },
    });
    return candidate?.id ?? '';
  }

  private actionForHandling(
    h: ImportDuplicateHandling,
  ): ImportDuplicateMatch['action'] {
    if (h === 'UPDATE') return 'will-update';
    if (h === 'SKIP') return 'will-skip';
    return 'will-create-new';
  }

  private pushError(result: ImportResult, err: ImportRowError) {
    result.errors.push(err);
  }
  private pushWarning(result: ImportResult, warn: ImportRowWarning) {
    result.warnings.push(warn);
  }
  private errMsg(err: unknown, fallback: string): string {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'P2002') {
      return `${fallback}: a record with the same unique field already exists (likely a duplicate document number).`;
    }
    return e?.message ? `${fallback}: ${e.message}` : fallback;
  }
}
