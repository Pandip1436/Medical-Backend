import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CustomerActivityStatus,
  CustomerActivityType,
  CustomerType,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import {
  ImportCreditNoteDto,
  ImportCustomerDto,
  ImportCustomersDto,
  ImportDuplicateHandling,
  ImportDuplicateMatch,
  ImportInvoiceDto,
  ImportPaymentDto,
  ImportRefundDto,
  ImportQuotationDto,
  ImportResult,
  ImportRowError,
  ImportRowWarning,
  ImportSummary,
} from './dto/import-customers.dto';

// Allowed quotation status values straight from the Prisma enum (kept as a
// local string union so we don't have to import QuotationStatus alongside
// InvoiceStatus when only one is being narrowed at call sites).
const QUOTATION_STATUSES = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'CONVERTED',
] as const;
type QuotationStatusLiteral = (typeof QUOTATION_STATUSES)[number];

// Strip everything except digits — mirrors customers.service.normalizePhone()
// so duplicate detection here behaves identically to the rest of the app.
function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

// Last-10-digit key is the canonical way the rest of the codebase fuzzes
// phone numbers ("9876543210", "+91 98765 43210" → "9876543210"). Keep
// behaviour consistent so a customer that exists in the DB matches an Excel
// row even when the operator typed the number differently.
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
    customers: { created: 0, updated: 0, skipped: 0, failed: 0 },
    invoices: { created: 0, skipped: 0, failed: 0 },
    invoiceItems: { created: 0 },
    payments: { created: 0, skipped: 0, failed: 0 },
    refunds: { created: 0, failed: 0 },
    activities: { created: 0, failed: 0 },
    prescriptions: { created: 0, failed: 0 },
    quotations: { created: 0, skipped: 0, failed: 0 },
    quotationItems: { created: 0 },
    creditNotes: { created: 0, skipped: 0, failed: 0 },
    creditNoteItems: { created: 0 },
    openingBalanceApplied: 0,
  };
}

// Excel cells can arrive as `Date` objects, ISO strings, dd/mm/yyyy, dd-mm-yyyy,
// or Excel serial numbers (days since 1900). Be liberal — refuse to silently
// drop history because someone's locale formats dates differently.
function parseDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial → JS Date. Excel's epoch is 1899-12-30 (the 1900 leap-year
    // bug means we use -25569 here, matching SheetJS's date1904=false output).
    const ms = (raw - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // ISO first
    const iso = new Date(trimmed);
    if (!isNaN(iso.getTime())) return iso;
    // dd/mm/yyyy or dd-mm-yyyy
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

function toNumber(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== 'string') return 0;
  const n = Number(raw.replace(/[, ₹$]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class CustomerImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  // Reserve a document number in its OWN committed transaction. Used when a
  // user-provided number collides with an unrelated record elsewhere in the
  // system (see the renumber-on-collision handling in createInvoice /
  // createPayment / createRefund / createQuotation / createCreditNote).
  // Calling nextNumber() inside the same transaction as the record insert
  // doesn't work for this case: Postgres rolls back the WHOLE transaction —
  // including the counter increment — when the insert fails, so a retry
  // inside that transaction would regenerate the exact same (still-
  // colliding) number forever. A separate, already-committed reservation
  // guarantees forward progress.
  private async reserveFreshNumber(
    docType: Parameters<DocumentNumberingService['nextNumber']>[1],
    branchId?: string | null,
  ): Promise<string> {
    return this.prisma.$transaction((tx) =>
      this.numbering.nextNumber(tx, docType, branchId ?? null),
    );
  }

  // Single entry point for both /preview and /commit. `dryRun` toggles whether
  // we open a transaction and roll back, vs. write for real. Either way we
  // collect the same error/warning/duplicate diagnostics so the UI shows the
  // user exactly what would happen.
  async runImport(
    dto: ImportCustomersDto,
    ctx: { userId: string; branchId?: string | null },
  ): Promise<ImportResult> {
    if (!dto?.customers?.length) {
      throw new BadRequestException(
        'No customers provided in the import payload.',
      );
    }

    const dryRun = !!dto.dryRun;
    const result: ImportResult = emptyResult(dryRun);

    // ── Phase 1: in-payload validation (no DB) ──
    // Catches name/phone gaps, intra-file phone collisions, and obvious
    // structural problems before we open a transaction.
    const validRows = this.validatePayload(dto.customers, result);
    if (validRows.length === 0) {
      return result;
    }

    // ── Phase 2: resolve existing customers by phone (1 batched query) ──
    const phoneKeys = Array.from(
      new Set(validRows.map((c) => phoneKey(c.phone)).filter(Boolean)),
    );
    const existing = await this.findExistingByPhones(phoneKeys, ctx.branchId);
    const existingByKey = new Map<
      string,
      { id: string; name: string; phone: string; branchId: string | null }
    >();
    for (const e of existing) {
      existingByKey.set(phoneKey(e.phone), e);
    }

    // Record duplicate matches up-front so the UI preview shows them even
    // before commit. The `action` derived from duplicateHandling tells the
    // user exactly what we'll do at commit time.
    for (const c of validRows) {
      const k = phoneKey(c.phone);
      if (!k) continue;
      const e = existingByKey.get(k);
      if (!e) continue;
      result.duplicates.push({
        customerCode: c.customerCode,
        sourceRow: c.sourceRow ?? 0,
        action: this.actionForHandling(dto.duplicateHandling),
        existingCustomer: { id: e.id, name: e.name, phone: e.phone },
      });
    }

    // ── Phase 3: write (real or simulated) ──
    if (dryRun) {
      // Simulate counts so the preview banner is accurate without any DB writes.
      this.simulate(validRows, existingByKey, dto.duplicateHandling, result);
      return result;
    }

    // Real run — per-row writes, no top-level transaction.
    //
    // Why no single mega-transaction: in Postgres, the moment any statement
    // inside a transaction errors, every subsequent statement in that same
    // transaction also fails ("current transaction is aborted, commands
    // ignored until end of transaction block", SQLSTATE 25P02). With a
    // try/catch per row inside one big tx, a single bad invoice number
    // collision would silently poison every later row. Per-row writes give
    // us the partial-success behaviour the UI's row-error contract assumes.
    //
    // Atomicity that *does* matter (invoice number + invoice insert) is
    // scoped to a tiny per-invoice transaction inside createInvoice().
    for (const row of validRows) {
      await this.processRow(
        row,
        existingByKey,
        dto.duplicateHandling,
        ctx,
        result,
      );
    }

    // Imported invoices / payments / credit notes carry file-supplied numbers
    // that bypass the sequence counters — resync so live creates don't collide.
    await this.numbering.resyncSequences();
    return result;
  }

  // ── Phase 1: payload validation ────────────────────────────────────────────

  private validatePayload(
    rows: ImportCustomerDto[],
    result: ImportResult,
  ): ImportCustomerDto[] {
    const seenPhones = new Map<string, number>(); // last10 → first sourceRow
    const seenCodes = new Map<string, number>();
    const valid: ImportCustomerDto[] = [];

    for (const row of rows) {
      const src = row.sourceRow ?? 0;
      const name = (row.name ?? '').trim();
      const rawPhone = (row.phone ?? '').toString().trim();
      const last10 = phoneKey(rawPhone);

      if (!name) {
        this.pushError(result, {
          sheet: 'Customers',
          row: src,
          customerCode: row.customerCode,
          field: 'name',
          message: 'Name is required.',
        });
        result.summary.customers.failed++;
        continue;
      }
      if (!last10 || last10.length !== 10) {
        this.pushError(result, {
          sheet: 'Customers',
          row: src,
          customerCode: row.customerCode,
          field: 'phone',
          message: `Phone "${rawPhone}" must be a 10-digit number (extra spaces / country code OK).`,
        });
        result.summary.customers.failed++;
        continue;
      }

      // Intra-file phone duplicate — likely a copy-paste mistake. Flag the
      // second occurrence as a warning (we still import the first) so the
      // user can decide whether to clean up the workbook.
      if (seenPhones.has(last10)) {
        this.pushWarning(result, {
          kind: 'duplicate',
          sheet: 'Customers',
          row: src,
          customerCode: row.customerCode,
          field: 'phone',
          message: `Same phone appears earlier in this file at row ${seenPhones.get(last10)}. Only the first row will be imported.`,
        });
        result.summary.customers.skipped++;
        continue;
      }
      seenPhones.set(last10, src);

      // Intra-file code duplicate — invoices/payments linked to this code
      // would be ambiguous, so we reject the second.
      const code = (row.customerCode ?? '').trim();
      if (code) {
        if (seenCodes.has(code)) {
          this.pushError(result, {
            sheet: 'Customers',
            row: src,
            customerCode: code,
            field: 'customer_code',
            message: `Duplicate customer_code "${code}" — already used at row ${seenCodes.get(code)}.`,
          });
          result.summary.customers.failed++;
          continue;
        }
        seenCodes.set(code, src);
      }

      // Type coercion is permissive: workbook may have "retail"/"Retail"/"R"
      // — let the frontend uppercase; we still defensively enum-check.
      const rawType: unknown = row.type;
      if (rawType && !this.isCustomerType(rawType)) {
        this.pushWarning(result, {
          kind: 'coerced',
          sheet: 'Customers',
          row: src,
          customerCode: code,
          field: 'type',
          message: `Type "${typeof rawType === 'string' ? rawType : 'unknown'}" not recognised — falling back to RETAIL.`,
        });
        row.type = CustomerType.RETAIL;
      }

      valid.push(row);
    }
    return valid;
  }

  // ── Phase 2: existing-customer lookup ──────────────────────────────────────

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

    // We can't index by the last-10 view in Postgres without an extra column,
    // so use a phone-contains OR clause keyed by each last10. List is bounded
    // by ArrayMaxSize on the DTO so this stays cheap.
    //
    // Two ANDed conditions: (any phone matches) AND (branch is this-branch or
    // null). Spreading two `OR:` keys into the same object literal would
    // silently drop the first — JS keeps only the last duplicate key. So we
    // build the conditions as an explicit AND array.
    const where: Prisma.CustomerWhereInput = {
      AND: [
        { OR: last10Keys.map((k) => ({ phone: { contains: k } })) },
        ...(branchId ? [{ OR: [{ branchId }, { branchId: null }] }] : []),
      ],
    };
    const candidates = await this.prisma.customer.findMany({
      where,
      select: { id: true, name: true, phone: true, branchId: true },
    });
    // Filter strictly by last10 — `contains` would match 11+ digit overlaps.
    return candidates.filter((c) => last10Keys.includes(phoneKey(c.phone)));
  }

  // ── Phase 3a: dry-run simulation ───────────────────────────────────────────

  private simulate(
    rows: ImportCustomerDto[],
    existingByKey: Map<string, { id: string; name: string; phone: string }>,
    handling: ImportDuplicateHandling,
    result: ImportResult,
  ) {
    for (const row of rows) {
      const isDup = existingByKey.has(phoneKey(row.phone));
      if (isDup) {
        if (handling === 'SKIP') {
          result.summary.customers.skipped++;
          // History rows attached to a skipped customer never get written —
          // surface that clearly so the user isn't surprised post-commit.
          if (
            row.invoices?.length ||
            row.payments?.length ||
            row.activities?.length ||
            row.prescriptions?.length
          ) {
            this.pushWarning(result, {
              kind: 'duplicate',
              sheet: 'Customers',
              row: row.sourceRow ?? 0,
              customerCode: row.customerCode,
              message: `Customer is a duplicate and you chose SKIP — its ${row.invoices?.length ?? 0} invoices, ${row.payments?.length ?? 0} payments, ${row.activities?.length ?? 0} activities, ${row.prescriptions?.length ?? 0} prescriptions will also be skipped.`,
            });
          }
          continue;
        }
        if (handling === 'UPDATE') result.summary.customers.updated++;
        if (handling === 'CREATE') result.summary.customers.created++;
      } else {
        result.summary.customers.created++;
      }
      result.summary.invoices.created += row.invoices?.length ?? 0;
      result.summary.invoiceItems.created += (row.invoices ?? []).reduce(
        (s, inv) => s + (inv.items?.length ?? 0),
        0,
      );
      result.summary.payments.created += row.payments?.length ?? 0;
      result.summary.activities.created += row.activities?.length ?? 0;
      result.summary.prescriptions.created += row.prescriptions?.length ?? 0;
      result.summary.quotations.created += row.quotations?.length ?? 0;
      result.summary.quotationItems.created += (row.quotations ?? []).reduce(
        (s, q) => s + (q.items?.length ?? 0),
        0,
      );
      result.summary.creditNotes.created += row.creditNotes?.length ?? 0;
      result.summary.creditNoteItems.created += (row.creditNotes ?? []).reduce(
        (s, cn) => s + (cn.items?.length ?? 0),
        0,
      );
      if (typeof row.openingBalance === 'number' && row.openingBalance > 0) {
        result.summary.openingBalanceApplied += row.openingBalance;
      }

      // Surface "we will auto-generate a number" warnings here too — these
      // would otherwise only appear on commit, but the operator needs to see
      // them at preview time to decide whether to fix the workbook first.
      for (const inv of row.invoices ?? []) {
        if (!inv.invoiceNumber?.trim()) {
          this.pushWarning(result, {
            kind: 'coerced',
            sheet: 'Invoices',
            row: inv.sourceRow ?? 0,
            customerCode: row.customerCode,
            field: 'invoice_number',
            message:
              'invoice_number is blank — a new number will be auto-generated on import. This will NOT match the original bill copy. Fill in the legacy invoice number to keep reconciliation working.',
          });
        }
      }
      for (const pay of row.payments ?? []) {
        if (!pay.receiptNumber?.trim()) {
          this.pushWarning(result, {
            kind: 'coerced',
            sheet: 'Payments',
            row: pay.sourceRow ?? 0,
            customerCode: row.customerCode,
            field: 'receipt_number',
            message:
              "receipt_number is blank — a new number will be auto-generated. Fill in the legacy receipt number to keep reconciliation with the customer's receipt copy.",
          });
        }
      }
      for (const q of row.quotations ?? []) {
        if (!q.quotationNumber?.trim()) {
          this.pushWarning(result, {
            kind: 'coerced',
            sheet: 'Quotations',
            row: q.sourceRow ?? 0,
            customerCode: row.customerCode,
            field: 'quotation_number',
            message:
              'quotation_number is blank — a new number will be auto-generated on import.',
          });
        }
      }
      for (const cn of row.creditNotes ?? []) {
        if (!cn.creditNoteNo?.trim()) {
          this.pushWarning(result, {
            kind: 'coerced',
            sheet: 'Credit Notes',
            row: cn.sourceRow ?? 0,
            customerCode: row.customerCode,
            field: 'credit_note_no',
            message:
              'credit_note_no is blank — a new number will be auto-generated on import.',
          });
        }
      }
    }
  }

  // ── Phase 3b: real import ──────────────────────────────────────────────────

  private async processRow(
    row: ImportCustomerDto,
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

    let customerId: string;
    if (existing) {
      if (handling === 'SKIP') {
        result.summary.customers.skipped++;
        return; // children skipped along with parent
      }
      if (handling === 'CREATE') {
        // We don't auto-fork a second customer with a mangled phone — the rest
        // of the app keys customer history on phone, and two customers sharing
        // a phone would silently split future activity. Surface a hard error
        // so admin re-thinks their strategy.
        this.pushError(result, {
          sheet: 'Customers',
          row: row.sourceRow ?? 0,
          customerCode: row.customerCode,
          field: 'phone',
          message: `CREATE strategy refused: phone "${row.phone}" is already used by customer "${existing.name}". Choose UPDATE or SKIP instead.`,
        });
        result.summary.customers.failed++;
        return;
      }
      // handling === 'UPDATE'
      try {
        customerId = existing.id;
        const updateData = this.buildCustomerUpdateData(row);

        // Branch-claim: if the existing record was created without a branch
        // (e.g. by an earlier import path that didn't resolve the branch
        // properly) AND this import is scoped to a branch, attach it. This
        // is how operators rescue orphaned customers that don't show in any
        // branch-filtered view. We never go the other way (claimed → null)
        // because that would silently un-scope a customer the admin already
        // assigned to a branch.
        if (existing.branchId === null && ctx.branchId) {
          updateData.branch = { connect: { id: ctx.branchId } };
          this.pushWarning(result, {
            kind: 'coerced',
            sheet: 'Customers',
            row: row.sourceRow ?? 0,
            customerCode: row.customerCode,
            field: 'branchId',
            message:
              "Existing customer had no branch — claiming it to your active branch so it shows in this branch's list.",
          });
        }

        await this.prisma.customer.update({
          where: { id: existing.id },
          data: updateData,
        });
        result.summary.customers.updated++;

        // Reclaim orphan history rows. Even if the parent customer was
        // already attached to a branch by a previous rescue, prior imports
        // may have left invoices/payments/activities/prescriptions with
        // branchId=null. They contribute to the customer's totals (cross-
        // branch aggregates) but disappear from branch-scoped tabs. Sweep
        // them up here so the customer detail tabs render correctly.
        if (ctx.branchId) {
          await this.reclaimOrphanChildren(
            customerId,
            ctx.branchId,
            row,
            result,
          );
        }
      } catch (err) {
        this.pushError(result, {
          sheet: 'Customers',
          row: row.sourceRow ?? 0,
          customerCode: row.customerCode,
          message: this.errMsg(err, 'Failed to update existing customer'),
        });
        result.summary.customers.failed++;
        return;
      }
    } else {
      try {
        const created = await this.prisma.customer.create({
          data: this.buildCustomerCreateData(row, ctx.branchId ?? null),
          select: { id: true },
        });
        customerId = created.id;
        result.summary.customers.created++;
      } catch (err) {
        this.pushError(result, {
          sheet: 'Customers',
          row: row.sourceRow ?? 0,
          customerCode: row.customerCode,
          message: this.errMsg(err, 'Failed to create customer'),
        });
        result.summary.customers.failed++;
        return;
      }
    }

    // ── Opening balance ──
    // Set, don't add — re-importing a customer with the same opening balance
    // shouldn't double up. UPDATE strategy explicitly opts into rewriting
    // existing rows; opening balance follows that contract.
    if (typeof row.openingBalance === 'number' && row.openingBalance !== 0) {
      try {
        await this.prisma.customer.update({
          where: { id: customerId },
          data: { currentOutstanding: new Prisma.Decimal(row.openingBalance) },
        });
        result.summary.openingBalanceApplied += row.openingBalance;
      } catch (err) {
        this.pushError(result, {
          sheet: 'Customers',
          row: row.sourceRow ?? 0,
          customerCode: row.customerCode,
          field: 'opening_balance',
          message: this.errMsg(err, 'Failed to apply opening balance'),
        });
      }
    }

    // ── Invoices + items ──
    // invoiceNumberRedirects tracks original -> actual invoice_number for
    // any invoice that got renumbered on a cross-branch collision (see
    // createInvoice). A credit note later in this SAME row that references
    // the original number needs to resolve to what was actually stored.
    const invoiceNumberRedirects = new Map<string, string>();
    for (const inv of row.invoices ?? []) {
      await this.createInvoice(
        inv,
        row,
        customerId,
        ctx,
        result,
        invoiceNumberRedirects,
      );
    }

    // ── Payments ──
    for (const pay of row.payments ?? []) {
      await this.createPayment(
        pay,
        row,
        customerId,
        ctx,
        result,
        invoiceNumberRedirects,
      );
    }

    // ── Activities ──
    // CustomerActivity has no DB-level uniqueness key, so naive re-imports
    // would silently double-up the activity log. Do an app-level dedup by
    // checking for an existing row with the same (customer, type, when, notes)
    // tuple before insert. Skips count as warnings, not errors.
    for (const act of row.activities ?? []) {
      try {
        const resolvedOccurredAt =
          act.type === CustomerActivityType.REMINDER
            ? null
            : (parseDate(act.occurredAt) ?? new Date());
        const resolvedDueAt =
          act.type === CustomerActivityType.REMINDER
            ? parseDate(act.dueAt)
            : null;

        const existingAct = await this.prisma.customerActivity.findFirst({
          where: {
            customerId,
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
            customerCode: row.customerCode,
            message: `Activity already exists for this customer (same type / time / notes) — left untouched.`,
          });
          continue;
        }

        await this.prisma.customerActivity.create({
          data: {
            customer: { connect: { id: customerId } },
            createdBy: { connect: { id: ctx.userId } },
            type: act.type,
            notes: act.notes ?? null,
            title:
              act.type === CustomerActivityType.REMINDER
                ? (act.title ?? null)
                : null,
            subject:
              act.type === CustomerActivityType.EMAIL
                ? (act.subject ?? null)
                : null,
            contactName: act.contactName ?? null,
            occurredAt: resolvedOccurredAt,
            dueAt: resolvedDueAt,
            status:
              act.type === CustomerActivityType.REMINDER
                ? (act.status ?? CustomerActivityStatus.PENDING)
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
          customerCode: row.customerCode,
          message: this.errMsg(err, 'Failed to create activity'),
        });
        result.summary.activities.failed++;
      }
    }

    // ── Prescriptions ──
    // Same app-level dedup as activities — Prescription has no uniqueness
    // constraint we can rely on. Match by (customer, doctor, validUntil)
    // which is what humans treat as "the same prescription."
    for (const rx of row.prescriptions ?? []) {
      try {
        const resolvedValidUntil = parseDate(rx.validUntil);
        const existingRx = await this.prisma.prescription.findFirst({
          where: {
            customerId,
            doctorName: rx.doctorName,
            ...(resolvedValidUntil
              ? { validUntil: resolvedValidUntil }
              : { validUntil: null }),
          },
          select: { id: true },
        });
        if (existingRx) {
          this.pushWarning(result, {
            kind: 'duplicate',
            sheet: 'Prescriptions',
            row: rx.sourceRow ?? 0,
            customerCode: row.customerCode,
            message: `Prescription from "${rx.doctorName}" already exists for this customer — left untouched.`,
          });
          continue;
        }
        await this.prisma.prescription.create({
          data: {
            customer: { connect: { id: customerId } },
            doctorName: rx.doctorName,
            notes: rx.notes ?? null,
            validUntil: resolvedValidUntil,
            isActive: true,
            ...(ctx.branchId
              ? { branch: { connect: { id: ctx.branchId } } }
              : {}),
          },
        });
        result.summary.prescriptions.created++;
      } catch (err) {
        this.pushError(result, {
          sheet: 'Prescriptions',
          row: rx.sourceRow ?? 0,
          customerCode: row.customerCode,
          message: this.errMsg(err, 'Failed to create prescription'),
        });
        result.summary.prescriptions.failed++;
      }
    }

    // ── Quotations + items ──
    for (const q of row.quotations ?? []) {
      await this.createQuotation(q, row, customerId, ctx, result);
    }

    // ── Credit Notes + items ──
    // Each credit note must point at an existing Invoice (FK constraint),
    // looked up by invoice_number scoped to this customer. We do that lookup
    // inside the helper so a typo in the workbook surfaces as a clear "couldn't
    // find that invoice" error instead of a generic FK violation.
    // creditNoteNoRedirects tracks original -> actual credit_note_no for any
    // credit note that got renumbered on a cross-branch collision — a refund
    // later in this row referencing the original number needs to resolve to
    // what was actually stored.
    const creditNoteNoRedirects = new Map<string, string>();
    for (const cn of row.creditNotes ?? []) {
      await this.createCreditNote(
        cn,
        row,
        customerId,
        ctx,
        result,
        invoiceNumberRedirects,
        creditNoteNoRedirects,
      );
    }

    // ── Refunds ──
    // Process after credit notes so a refund referencing one imported in the
    // same workbook can resolve it.
    for (const r of row.refunds ?? []) {
      await this.createRefund(
        r,
        row,
        customerId,
        ctx,
        result,
        creditNoteNoRedirects,
      );
    }
  }

  // ── Invoice creation helper ───────────────────────────────────────────────
  // Scoped to a small per-invoice transaction so:
  //   (a) auto-generated invoice number + invoice insert + item inserts are
  //       atomic — a failed item won't leave a headless invoice behind,
  //   (b) if a *different* invoice in the workbook fails, this one is safe.
  //
  // Historical totals are preserved exactly as given. We never recompute
  // taxes / subtotals — that would silently mutate the user's books.
  //
  // Retry on P2002: if the user left invoice_number blank we auto-generate
  // one via DocumentNumberingService. When the underlying DocumentSequence
  // counter is behind real-world invoices (e.g. seeded data, manual entry,
  // restored backup), the first generated number can collide. We retry with
  // a fresh counter value up to MAX_GENERATED_RETRIES times. If the user
  // *did* specify an invoice_number explicitly, we do NOT retry — that's a
  // real conflict the user needs to resolve.
  private async createInvoice(
    inv: ImportInvoiceDto,
    parent: ImportCustomerDto,
    customerId: string,
    ctx: { userId: string; branchId?: string | null },
    result: ImportResult,
    invoiceNumberRedirects: Map<string, string>,
  ): Promise<void> {
    // 200, not 5: when a user-provided number collides with a DIFFERENT
    // branch's document (common on cross-branch migration — see
    // reserveFreshNumber), the freshly-reserved branch-local counter has to
    // climb past every number the OTHER branch already used before landing
    // on free ground. A branch with hundreds of historical documents needs a
    // correspondingly large budget; each attempt is a cheap single-row
    // reservation, so a generous cap costs little.
    const MAX_GENERATED_RETRIES = 200;
    const originalNumber = inv.invoiceNumber?.trim();
    let userProvidedNumber = originalNumber;
    let lastErr: unknown = null;
    let itemCount = 0;
    let renumbered = false;
    let actualInvoiceNumber = '';

    // Historical imports almost always carry an original invoice number from
    // the source system — that's what's printed on the customer's bill copy.
    // Auto-generating means the imported record won't match the physical bill.
    // Surface a warning so the operator can decide whether to re-upload with
    // the right number filled in.
    if (!userProvidedNumber) {
      this.pushWarning(result, {
        kind: 'coerced',
        sheet: 'Invoices',
        row: inv.sourceRow ?? 0,
        customerCode: parent.customerCode,
        field: 'invoice_number',
        message:
          "invoice_number was blank — auto-generating one. This number will NOT match the customer's original bill copy. Fill in the legacy invoice number to keep reconciliation working.",
      });
    }

    for (let attempt = 0; attempt <= MAX_GENERATED_RETRIES; attempt++) {
      try {
        itemCount = await this.prisma.$transaction(async (tx) => {
          const invoiceNumber =
            userProvidedNumber ||
            (await this.numbering.nextNumber(tx, 'INV', ctx.branchId ?? null));
          actualInvoiceNumber = invoiceNumber;

          const billingType =
            inv.billingType?.toUpperCase() === 'WHOLESALE'
              ? 'WHOLESALE'
              : 'RETAIL';

          const status: InvoiceStatus =
            inv.status && Object.values(InvoiceStatus).includes(inv.status)
              ? inv.status
              : (inv.amountPaid ?? 0) >= (inv.grandTotal ?? 0)
                ? InvoiceStatus.PAID
                : (inv.amountPaid ?? 0) > 0
                  ? InvoiceStatus.PARTIAL
                  : InvoiceStatus.UNPAID;

          const customer = await tx.customer.findUnique({
            where: { id: customerId },
            select: { name: true },
          });

          const created = await tx.invoice.create({
            data: {
              invoiceNumber,
              date: parseDate(inv.date) ?? new Date(),
              type: 'INVOICE',
              billingType,
              customer: { connect: { id: customerId } },
              customerName: customer?.name ?? parent.name,
              createdBy: { connect: { id: ctx.userId } },
              subtotal: new Prisma.Decimal(inv.subtotal ?? 0),
              productDiscount: new Prisma.Decimal(inv.productDiscount ?? 0),
              taxableAmount: new Prisma.Decimal(
                inv.taxableAmount ?? inv.subtotal ?? 0,
              ),
              cgst: new Prisma.Decimal(inv.cgst ?? 0),
              sgst: new Prisma.Decimal(inv.sgst ?? 0),
              igst: new Prisma.Decimal(inv.igst ?? 0),
              deliveryCharge: new Prisma.Decimal(inv.deliveryCharge ?? 0),
              roundOff: new Prisma.Decimal(inv.roundOff ?? 0),
              grandTotal: new Prisma.Decimal(inv.grandTotal ?? 0),
              amountPaid: new Prisma.Decimal(inv.amountPaid ?? 0),
              paymentMode: this.coercePaymentMode(inv.paymentMode),
              status,
              ...(ctx.branchId
                ? { branch: { connect: { id: ctx.branchId } } }
                : {}),
            },
            select: { id: true },
          });

          // Items — optional. A header-only invoice is valid for historical
          // data where the line-level breakdown is no longer available.
          let createdItems = 0;
          for (const item of inv.items ?? []) {
            const productId = await this.resolveProductId(
              tx,
              item.productName,
              ctx.branchId,
            );
            if (!productId && item.productName?.trim()) {
              this.pushWarning(result, {
                kind: 'missing-link',
                sheet: 'Invoice Items',
                row: inv.sourceRow ?? 0,
                customerCode: parent.customerCode,
                field: 'product_name',
                message: `Product "${item.productName}" not found — this line won't appear in that product's history (the invoice itself still imports fine).`,
              });
            }
            await tx.invoiceItem.create({
              data: {
                invoice: { connect: { id: created.id } },
                productId,
                productName: item.productName ?? 'Imported item',
                batchId: '',
                batchNumber: item.batchNumber ?? '',
                expiryDate: parseDate(item.expiryDate) ?? new Date(),
                quantity: Math.trunc(item.quantity ?? 0),
                mrp: new Prisma.Decimal(item.mrp ?? 0),
                rate: new Prisma.Decimal(item.rate ?? 0),
                discountPercent: new Prisma.Decimal(item.discountPercent ?? 0),
                gstPercent: new Prisma.Decimal(item.gstPercent ?? 0),
                amount: new Prisma.Decimal(item.amount ?? 0),
              },
            });
            createdItems++;
          }
          return createdItems;
        });

        // Success — record counts and exit retry loop.
        result.summary.invoices.created++;
        result.summary.invoiceItems.created += itemCount;
        if (originalNumber && actualInvoiceNumber !== originalNumber) {
          invoiceNumberRedirects.set(originalNumber, actualInvoiceNumber);
        }
        return;
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string })?.code;
        // Two cases for P2002 (unique constraint violation):
        //   (a) auto-generated number collided → retry with a fresh counter,
        //   (b) user-supplied number already exists → idempotent re-import.
        //       Skip silently with a warning so the operator knows we left
        //       the existing invoice alone instead of duplicating it.
        if (code === 'P2002') {
          if (!userProvidedNumber) {
            continue;
          }
          const existing = await this.prisma.invoice.findFirst({
            where: { customerId, invoiceNumber: userProvidedNumber },
            select: { id: true },
          });
          if (existing) {
            this.pushWarning(result, {
              kind: 'duplicate',
              sheet: 'Invoices',
              row: inv.sourceRow ?? 0,
              customerCode: parent.customerCode,
              field: 'invoice_number',
              message: `Invoice ${userProvidedNumber} already exists — leaving the existing record alone (no duplicate created).`,
            });
            result.summary.invoices.skipped++;
            return;
          }
          // invoice_number is globally unique in the schema but historical
          // numbers are only unique within the source branch — this collides
          // with an unrelated invoice elsewhere in the system. Renumber
          // instead of silently dropping the record.
          if (!renumbered) {
            this.pushWarning(result, {
              kind: 'coerced',
              sheet: 'Invoices',
              row: inv.sourceRow ?? 0,
              customerCode: parent.customerCode,
              field: 'invoice_number',
              message: `Invoice number "${userProvidedNumber}" is already used elsewhere in the system (different customer/branch) — a new number was generated so this invoice isn't lost.`,
            });
            renumbered = true;
          }
          userProvidedNumber = await this.reserveFreshNumber(
            'INV',
            ctx.branchId,
          );
          continue;
        }
        break;
      }
    }

    this.pushError(result, {
      sheet: 'Invoices',
      row: inv.sourceRow ?? 0,
      customerCode: parent.customerCode,
      message: this.errMsg(lastErr, 'Failed to create invoice'),
    });
    result.summary.invoices.failed++;
  }

  // ── Payment creation helper ───────────────────────────────────────────────
  // Same retry-on-generated-collision pattern as createInvoice.
  //
  // Imported payments don't allocate against invoices — they're historical
  // records, not new collection events. The customer's currentOutstanding
  // was either set via opening_balance or remains live-computed from
  // unpaid invoices; we deliberately don't double-decrement it here.
  private async createPayment(
    pay: ImportPaymentDto,
    parent: ImportCustomerDto,
    customerId: string,
    ctx: { userId: string; branchId?: string | null },
    result: ImportResult,
    invoiceNumberRedirects?: Map<string, string>,
  ): Promise<void> {
    const amount = toNumber(pay.amount);
    if (amount <= 0) {
      this.pushError(result, {
        sheet: 'Payments',
        row: pay.sourceRow ?? 0,
        customerCode: parent.customerCode,
        field: 'amount',
        message: 'Payment amount must be greater than zero.',
      });
      result.summary.payments.failed++;
      return;
    }

    // 200, not 5: when a user-provided number collides with a DIFFERENT
    // branch's document (common on cross-branch migration — see
    // reserveFreshNumber), the freshly-reserved branch-local counter has to
    // climb past every number the OTHER branch already used before landing
    // on free ground. A branch with hundreds of historical documents needs a
    // correspondingly large budget; each attempt is a cheap single-row
    // reservation, so a generous cap costs little.
    // Resolve the invoice this receipt paid (if the file linked one) so the
    // payment is attributed to it — invoiceNumberRedirects maps any invoice
    // renumbered on a cross-branch collision to the number actually stored.
    let linkedInvoiceId: string | null = null;
    const linkNumber = pay.invoiceNumber?.trim();
    if (linkNumber) {
      const actualNumber = invoiceNumberRedirects?.get(linkNumber) ?? linkNumber;
      const inv = await this.prisma.invoice.findFirst({
        where: { customerId, invoiceNumber: actualNumber },
        select: { id: true },
      });
      linkedInvoiceId = inv?.id ?? null;
    }

    const MAX_GENERATED_RETRIES = 200;
    let userProvidedReceipt = pay.receiptNumber?.trim();
    let lastErr: unknown = null;
    let renumbered = false;

    if (!userProvidedReceipt) {
      this.pushWarning(result, {
        kind: 'coerced',
        sheet: 'Payments',
        row: pay.sourceRow ?? 0,
        customerCode: parent.customerCode,
        field: 'receipt_number',
        message:
          "receipt_number was blank — auto-generating one. Fill in the legacy receipt number to keep reconciliation with the customer's receipt copy.",
      });
    }

    for (let attempt = 0; attempt <= MAX_GENERATED_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const receiptNumber =
            userProvidedReceipt ||
            (await this.numbering.nextNumber(tx, 'RCPT', ctx.branchId ?? null));

          await tx.payment.create({
            data: {
              receiptNumber,
              customer: { connect: { id: customerId } },
              amount: new Prisma.Decimal(amount),
              paymentMode: this.coercePaymentMode(pay.paymentMode),
              referenceNumber: pay.referenceNumber ?? null,
              notes: pay.notes ?? null,
              createdAt: parseDate(pay.date) ?? new Date(),
              ...(linkedInvoiceId
                ? { invoice: { connect: { id: linkedInvoiceId } } }
                : {}),
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
        // Same idempotent-skip pattern as createInvoice (see comment there).
        if (code === 'P2002') {
          if (!userProvidedReceipt) {
            continue;
          }
          const existing = await this.prisma.payment.findFirst({
            where: { customerId, receiptNumber: userProvidedReceipt },
            select: { id: true },
          });
          if (existing) {
            this.pushWarning(result, {
              kind: 'duplicate',
              sheet: 'Payments',
              row: pay.sourceRow ?? 0,
              customerCode: parent.customerCode,
              field: 'receipt_number',
              message: `Receipt ${userProvidedReceipt} already exists — leaving the existing payment alone (no duplicate created).`,
            });
            result.summary.payments.skipped++;
            return;
          }
          // receipt_number is globally unique in the schema but historical
          // numbers are only unique within the source branch — this collides
          // with an unrelated payment elsewhere in the system. Renumber
          // instead of silently dropping the record.
          if (!renumbered) {
            this.pushWarning(result, {
              kind: 'coerced',
              sheet: 'Payments',
              row: pay.sourceRow ?? 0,
              customerCode: parent.customerCode,
              field: 'receipt_number',
              message: `Receipt number "${userProvidedReceipt}" is already used elsewhere in the system (different customer/branch) — a new number was generated so this payment isn't lost.`,
            });
            renumbered = true;
          }
          userProvidedReceipt = await this.reserveFreshNumber(
            'RCPT',
            ctx.branchId,
          );
          continue;
        }
        break;
      }
    }

    this.pushError(result, {
      sheet: 'Payments',
      row: pay.sourceRow ?? 0,
      customerCode: parent.customerCode,
      message: this.errMsg(lastErr, 'Failed to create payment'),
    });
    result.summary.payments.failed++;
  }

  // ── Refund creation helper ────────────────────────────────────────────────
  // A refund always belongs to exactly one credit note (Refund.creditNoteId is
  // a required unique FK — mirrors the live approve-credit-note flow in
  // credit-notes.service.ts, which uses the same 'REF' numbering prefix).
  // Doesn't touch currentOutstanding — same historical-record reasoning as
  // createPayment().
  private async createRefund(
    r: ImportRefundDto,
    parent: ImportCustomerDto,
    customerId: string,
    ctx: { userId: string; branchId?: string | null },
    result: ImportResult,
    creditNoteNoRedirects: Map<string, string>,
  ): Promise<void> {
    const amount = toNumber(r.amount);
    if (amount <= 0) {
      this.pushError(result, {
        sheet: 'Refunds',
        row: r.sourceRow ?? 0,
        customerCode: parent.customerCode,
        field: 'amount',
        message: 'Refund amount must be greater than zero.',
      });
      result.summary.refunds.failed++;
      return;
    }

    const creditNoteNo = r.creditNoteNo?.trim();
    // The referenced credit note may have been renumbered earlier in this
    // same import run (see createCreditNote's cross-branch renumbering) —
    // resolve through the redirect map before falling back to the raw sheet
    // value.
    const resolvedCreditNoteNo = creditNoteNo
      ? (creditNoteNoRedirects.get(creditNoteNo) ?? creditNoteNo)
      : undefined;
    const parentCreditNote = resolvedCreditNoteNo
      ? await this.prisma.creditNote.findFirst({
          where: { customerId, creditNoteNo: resolvedCreditNoteNo },
          select: { id: true, invoiceId: true },
        })
      : null;
    if (!parentCreditNote) {
      this.pushError(result, {
        sheet: 'Refunds',
        row: r.sourceRow ?? 0,
        customerCode: parent.customerCode,
        field: 'credit_note_no',
        message: `Credit note "${creditNoteNo}" not found for this customer. Import the parent credit note first, or correct credit_note_no.`,
      });
      result.summary.refunds.failed++;
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
    let userProvidedNumber = r.refundNumber?.trim();
    let lastErr: unknown = null;
    let renumbered = false;

    for (let attempt = 0; attempt <= MAX_GENERATED_RETRIES; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const refundNumber =
            userProvidedNumber ||
            (await this.numbering.nextNumber(tx, 'REF', ctx.branchId ?? null));

          await tx.refund.create({
            data: {
              refundNumber,
              creditNote: { connect: { id: parentCreditNote.id } },
              customer: { connect: { id: customerId } },
              ...(parentCreditNote.invoiceId
                ? { invoice: { connect: { id: parentCreditNote.invoiceId } } }
                : {}),
              amount: new Prisma.Decimal(amount),
              paymentMode: this.coercePaymentMode(r.paymentMode),
              notes: r.notes ?? null,
              createdById: ctx.userId,
              createdAt: parseDate(r.date) ?? new Date(),
              ...(ctx.branchId
                ? { branch: { connect: { id: ctx.branchId } } }
                : {}),
            },
          });
        });
        result.summary.refunds.created++;
        return;
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string })?.code;
        if (code === 'P2002') {
          if (!userProvidedNumber) continue;
          const existing = await this.prisma.refund.findFirst({
            where: {
              OR: [
                { customerId, refundNumber: userProvidedNumber },
                { creditNoteId: parentCreditNote.id },
              ],
            },
            select: { id: true },
          });
          if (existing) {
            this.pushWarning(result, {
              kind: 'duplicate',
              sheet: 'Refunds',
              row: r.sourceRow ?? 0,
              customerCode: parent.customerCode,
              field: 'refund_number',
              message: `Refund ${userProvidedNumber} (or this credit note's refund) already exists — leaving the existing record alone (no duplicate created).`,
            });
            return;
          }
          // refund_number is globally unique in the schema but historical
          // numbers are only unique within the source branch — this collides
          // with an unrelated refund elsewhere in the system. Renumber
          // instead of silently dropping the record.
          if (!renumbered) {
            this.pushWarning(result, {
              kind: 'coerced',
              sheet: 'Refunds',
              row: r.sourceRow ?? 0,
              customerCode: parent.customerCode,
              field: 'refund_number',
              message: `Refund number "${userProvidedNumber}" is already used elsewhere in the system (different customer/branch) — a new number was generated so this refund isn't lost.`,
            });
            renumbered = true;
          }
          userProvidedNumber = await this.reserveFreshNumber(
            'REF',
            ctx.branchId,
          );
          continue;
        }
        break;
      }
    }

    this.pushError(result, {
      sheet: 'Refunds',
      row: r.sourceRow ?? 0,
      customerCode: parent.customerCode,
      message: this.errMsg(lastErr, 'Failed to create refund'),
    });
    result.summary.refunds.failed++;
  }

  // ── Quotation creation helper ────────────────────────────────────────────
  // Same per-write transaction + retry-on-generated-collision pattern as
  // createInvoice. Quotations are commercial documents that often live in the
  // legacy system before they were ever converted to invoices, so we preserve
  // the original quotation number when supplied. DocumentNumberingService
  // doesn't currently have a QTN docType in its enum, so for auto-generation
  // we synthesise a number locally — quotations are less audit-sensitive than
  // invoices, and the user is encouraged to fill in the legacy number anyway.
  private async createQuotation(
    q: ImportQuotationDto,
    parent: ImportCustomerDto,
    customerId: string,
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
    let userProvidedNumber = q.quotationNumber?.trim();
    let lastErr: unknown = null;
    let itemCount = 0;
    let renumbered = false;

    if (!userProvidedNumber) {
      this.pushWarning(result, {
        kind: 'coerced',
        sheet: 'Quotations',
        row: q.sourceRow ?? 0,
        customerCode: parent.customerCode,
        field: 'quotation_number',
        message:
          'quotation_number was blank — auto-generating one. Fill in the legacy quotation number to keep reconciliation with prior versions.',
      });
    }

    for (let attempt = 0; attempt <= MAX_GENERATED_RETRIES; attempt++) {
      try {
        itemCount = await this.prisma.$transaction(async (tx) => {
          // Locally synthesised QTN/<FY>/<NN> — DocumentSequence doesn't model
          // quotations. Suffix the attempt index so retries strictly produce a
          // distinct candidate.
          const quotationNumber =
            userProvidedNumber ||
            `QTN/IMP/${Date.now().toString(36).toUpperCase()}-${attempt}-${Math.floor(Math.random() * 1000)}`;

          const rawStatus = (q.status ?? '').toUpperCase().trim();
          const status: QuotationStatusLiteral = (
            QUOTATION_STATUSES as readonly string[]
          ).includes(rawStatus)
            ? (rawStatus as QuotationStatusLiteral)
            : 'DRAFT';

          const customer = await tx.customer.findUnique({
            where: { id: customerId },
            select: { name: true, phone: true },
          });

          const total = q.total ?? 0;

          const created = await tx.quotation.create({
            data: {
              quotationNumber,
              date: parseDate(q.date) ?? new Date(),
              customer: { connect: { id: customerId } },
              customerName: customer?.name ?? parent.name,
              customerPhone: customer?.phone ?? null,
              subtotal: new Prisma.Decimal(q.subtotal ?? 0),
              cgst: new Prisma.Decimal(q.cgst ?? 0),
              sgst: new Prisma.Decimal(q.sgst ?? 0),
              deliveryCharge: new Prisma.Decimal(q.deliveryCharge ?? 0),
              total: new Prisma.Decimal(total),
              validUntil: parseDate(q.validUntil),
              notes: q.notes ?? null,
              status,
              ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
            },
            select: { id: true },
          });

          // Items — optional. A header-only quotation is acceptable for
          // historical data where the line-level breakdown is missing.
          let createdItems = 0;
          for (const item of q.items ?? []) {
            await tx.quotationItem.create({
              data: {
                quotation: { connect: { id: created.id } },
                productName: item.productName ?? 'Imported item',
                quantity: Math.trunc(item.quantity ?? 0),
                mrp: new Prisma.Decimal(item.mrp ?? 0),
                rate: new Prisma.Decimal(item.rate ?? 0),
                discountPercent: new Prisma.Decimal(item.discountPercent ?? 0),
                gstPercent: new Prisma.Decimal(item.gstPercent ?? 0),
                amount: new Prisma.Decimal(item.amount ?? 0),
              },
            });
            createdItems++;
          }
          return createdItems;
        });

        result.summary.quotations.created++;
        result.summary.quotationItems.created += itemCount;
        return;
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string })?.code;
        // Same idempotent-skip semantics as createInvoice/createPayment.
        if (code === 'P2002') {
          if (!userProvidedNumber) {
            continue;
          }
          const existing = await this.prisma.quotation.findFirst({
            where: { customerId, quotationNumber: userProvidedNumber },
            select: { id: true },
          });
          if (existing) {
            this.pushWarning(result, {
              kind: 'duplicate',
              sheet: 'Quotations',
              row: q.sourceRow ?? 0,
              customerCode: parent.customerCode,
              field: 'quotation_number',
              message: `Quotation ${userProvidedNumber} already exists — leaving the existing record alone (no duplicate created).`,
            });
            result.summary.quotations.skipped++;
            return;
          }
          // quotation_number is globally unique in the schema but historical
          // numbers are only unique within the source branch — this collides
          // with an unrelated quotation elsewhere in the system. Renumber
          // instead of silently dropping the record.
          if (!renumbered) {
            this.pushWarning(result, {
              kind: 'coerced',
              sheet: 'Quotations',
              row: q.sourceRow ?? 0,
              customerCode: parent.customerCode,
              field: 'quotation_number',
              message: `Quotation number "${userProvidedNumber}" is already used elsewhere in the system (different customer/branch) — a new number was generated so this quotation isn't lost.`,
            });
            renumbered = true;
          }
          userProvidedNumber = undefined;
          continue;
        }
        break;
      }
    }

    this.pushError(result, {
      sheet: 'Quotations',
      row: q.sourceRow ?? 0,
      customerCode: parent.customerCode,
      message: this.errMsg(lastErr, 'Failed to create quotation'),
    });
    result.summary.quotations.failed++;
  }

  // ── Credit Note creation helper ──────────────────────────────────────────
  // CreditNote has a REQUIRED FK to Invoice (a return is always against a
  // specific bill). Resolution flow:
  //   1. Look up the parent invoice by (customerId, invoiceNumber). If the
  //      workbook references an invoice number we don't have, emit a clear
  //      error so the operator can fix the workbook — far better than letting
  //      Prisma throw an opaque FK violation.
  //   2. Same per-write transaction + retry-on-P2002 + skip-on-user-conflict
  //      pattern as createInvoice / createPayment / createQuotation.
  private async createCreditNote(
    cn: ImportCreditNoteDto,
    parent: ImportCustomerDto,
    customerId: string,
    ctx: { userId: string; branchId?: string | null },
    result: ImportResult,
    invoiceNumberRedirects: Map<string, string>,
    creditNoteNoRedirects: Map<string, string>,
  ): Promise<void> {
    const invoiceNumber = cn.invoiceNumber?.trim();
    if (!invoiceNumber) {
      this.pushError(result, {
        sheet: 'Credit Notes',
        row: cn.sourceRow ?? 0,
        customerCode: parent.customerCode,
        field: 'invoice_number',
        message:
          'invoice_number is required on a credit note — every return is against a specific invoice.',
      });
      result.summary.creditNotes.failed++;
      return;
    }

    // The referenced invoice may have been renumbered earlier in this same
    // import run (see createInvoice's cross-branch renumbering) — resolve
    // through the redirect map before falling back to the raw sheet value.
    const resolvedInvoiceNumber =
      invoiceNumberRedirects.get(invoiceNumber) ?? invoiceNumber;
    const parentInvoice = await this.prisma.invoice.findFirst({
      where: { customerId, invoiceNumber: resolvedInvoiceNumber },
      select: { id: true, invoiceNumber: true },
    });
    if (!parentInvoice) {
      this.pushError(result, {
        sheet: 'Credit Notes',
        row: cn.sourceRow ?? 0,
        customerCode: parent.customerCode,
        field: 'invoice_number',
        message: `Invoice "${invoiceNumber}" not found for this customer. Import the parent invoice first, or correct the invoice_number.`,
      });
      result.summary.creditNotes.failed++;
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
    const originalNumber = cn.creditNoteNo?.trim();
    let userProvidedNumber = originalNumber;
    let lastErr: unknown = null;
    let itemCount = 0;
    let renumbered = false;
    let actualCreditNoteNo = '';

    if (!userProvidedNumber) {
      this.pushWarning(result, {
        kind: 'coerced',
        sheet: 'Credit Notes',
        row: cn.sourceRow ?? 0,
        customerCode: parent.customerCode,
        field: 'credit_note_no',
        message:
          "credit_note_no was blank — auto-generating one. Fill in the legacy credit-note number to keep reconciliation with the customer's return copy.",
      });
    }

    for (let attempt = 0; attempt <= MAX_GENERATED_RETRIES; attempt++) {
      try {
        itemCount = await this.prisma.$transaction(async (tx) => {
          const creditNoteNo =
            userProvidedNumber ||
            (await this.numbering.nextNumber(tx, 'CN', ctx.branchId ?? null));
          actualCreditNoteNo = creditNoteNo;

          const rawMode = (cn.settlementMode ?? '').toUpperCase().trim();
          const settlementMode: 'REFUND' | 'CREDIT' | 'REPLACEMENT' =
            rawMode === 'CREDIT' || rawMode === 'REPLACEMENT'
              ? rawMode
              : 'REFUND';

          const customer = await tx.customer.findUnique({
            where: { id: customerId },
            select: { name: true },
          });

          const created = await tx.creditNote.create({
            data: {
              creditNoteNo,
              date: parseDate(cn.date) ?? new Date(),
              invoice: { connect: { id: parentInvoice.id } },
              invoiceNumber: parentInvoice.invoiceNumber,
              customer: { connect: { id: customerId } },
              customerName: customer?.name ?? parent.name,
              reason: cn.reason ?? 'Imported credit note',
              subtotal: new Prisma.Decimal(cn.subtotal ?? 0),
              cgst: new Prisma.Decimal(cn.cgst ?? 0),
              sgst: new Prisma.Decimal(cn.sgst ?? 0),
              igst: new Prisma.Decimal(cn.igst ?? 0),
              totalAmount: new Prisma.Decimal(cn.totalAmount ?? 0),
              settlementMode,
              notes: cn.notes ?? null,
              createdById: ctx.userId,
              ...(ctx.branchId
                ? { branch: { connect: { id: ctx.branchId } } }
                : {}),
            },
            select: { id: true },
          });

          let createdItems = 0;
          for (const item of cn.items ?? []) {
            const productId = await this.resolveProductId(
              tx,
              item.productName,
              ctx.branchId,
            );
            if (!productId && item.productName?.trim()) {
              this.pushWarning(result, {
                kind: 'missing-link',
                sheet: 'Credit Note Items',
                row: cn.sourceRow ?? 0,
                customerCode: parent.customerCode,
                field: 'product_name',
                message: `Product "${item.productName}" not found — this line won't appear in that product's history (the credit note itself still imports fine).`,
              });
            }
            await tx.creditNoteItem.create({
              data: {
                creditNote: { connect: { id: created.id } },
                productId,
                productName: item.productName ?? 'Imported item',
                batchId: '',
                batchNumber: item.batchNumber ?? '',
                expiryDate: parseDate(item.expiryDate) ?? new Date(),
                returnedQty: Math.trunc(item.returnedQty ?? 0),
                rate: new Prisma.Decimal(item.rate ?? 0),
                gstPercent: new Prisma.Decimal(item.gstPercent ?? 0),
                amount: new Prisma.Decimal(item.amount ?? 0),
              },
            });
            createdItems++;
          }
          return createdItems;
        });

        result.summary.creditNotes.created++;
        result.summary.creditNoteItems.created += itemCount;
        if (originalNumber && actualCreditNoteNo !== originalNumber) {
          creditNoteNoRedirects.set(originalNumber, actualCreditNoteNo);
        }
        return;
      } catch (err) {
        lastErr = err;
        const code = (err as { code?: string })?.code;
        if (code === 'P2002') {
          if (!userProvidedNumber) {
            continue;
          }
          const existing = await this.prisma.creditNote.findFirst({
            where: { customerId, creditNoteNo: userProvidedNumber },
            select: { id: true },
          });
          if (existing) {
            this.pushWarning(result, {
              kind: 'duplicate',
              sheet: 'Credit Notes',
              row: cn.sourceRow ?? 0,
              customerCode: parent.customerCode,
              field: 'credit_note_no',
              message: `Credit note ${userProvidedNumber} already exists — leaving the existing record alone (no duplicate created).`,
            });
            result.summary.creditNotes.skipped++;
            return;
          }
          // credit_note_no is globally unique in the schema but historical
          // numbers are only unique within the source branch — this collides
          // with an unrelated credit note elsewhere in the system. Renumber
          // instead of silently dropping the record.
          if (!renumbered) {
            this.pushWarning(result, {
              kind: 'coerced',
              sheet: 'Credit Notes',
              row: cn.sourceRow ?? 0,
              customerCode: parent.customerCode,
              field: 'credit_note_no',
              message: `Credit note number "${userProvidedNumber}" is already used elsewhere in the system (different customer/branch) — a new number was generated so this credit note isn't lost.`,
            });
            renumbered = true;
          }
          userProvidedNumber = await this.reserveFreshNumber(
            'CN',
            ctx.branchId,
          );
          continue;
        }
        break;
      }
    }

    this.pushError(result, {
      sheet: 'Credit Notes',
      row: cn.sourceRow ?? 0,
      customerCode: parent.customerCode,
      message: this.errMsg(lastErr, 'Failed to create credit note'),
    });
    result.summary.creditNotes.failed++;
  }

  // ── Orphan-child reclaim ─────────────────────────────────────────────────
  // When a customer is claimed to a branch via UPDATE strategy, sweep any of
  // their child rows still sitting in `branchId = null` onto the same branch.
  // Otherwise the customer header shows aggregates (cross-branch totals) but
  // the per-tab lists filter by branch and render as empty — confusing.
  private async reclaimOrphanChildren(
    customerId: string,
    branchId: string,
    row: ImportCustomerDto,
    result: ImportResult,
  ): Promise<void> {
    const [inv, pay, act, rx, qt, cn] = await Promise.all([
      this.prisma.invoice.updateMany({
        where: { customerId, branchId: null },
        data: { branchId },
      }),
      this.prisma.payment.updateMany({
        where: { customerId, branchId: null },
        data: { branchId },
      }),
      this.prisma.customerActivity.updateMany({
        where: { customerId, branchId: null },
        data: { branchId },
      }),
      this.prisma.prescription.updateMany({
        where: { customerId, branchId: null },
        data: { branchId },
      }),
      this.prisma.quotation.updateMany({
        where: { customerId, branchId: null },
        data: { branchId },
      }),
      this.prisma.creditNote.updateMany({
        where: { customerId, branchId: null },
        data: { branchId },
      }),
    ]);
    const totalMoved =
      inv.count + pay.count + act.count + rx.count + qt.count + cn.count;
    if (totalMoved > 0) {
      this.pushWarning(result, {
        kind: 'coerced',
        sheet: 'Customers',
        row: row.sourceRow ?? 0,
        customerCode: row.customerCode,
        field: 'branchId',
        message: `Reclaimed ${inv.count} orphan invoice(s), ${pay.count} payment(s), ${act.count} activity(ies), ${rx.count} prescription(s), ${qt.count} quotation(s), ${cn.count} credit note(s) onto your active branch.`,
      });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private buildCustomerCreateData(
    row: ImportCustomerDto,
    branchId: string | null,
  ): Prisma.CustomerCreateInput {
    return {
      name: row.name.trim(),
      phone: normalizePhone(row.phone),
      alternatePhone: row.alternatePhone?.trim() || null,
      email: row.email?.trim() || null,
      address: row.address?.trim() || null,
      type: row.type ?? CustomerType.RETAIL,
      source: row.source?.trim() || null,
      doctorRef: row.doctorRef?.trim() || null,
      referredBy: row.referredBy?.trim() || null,
      creditLimit: new Prisma.Decimal(row.creditLimit ?? 0),
      currentOutstanding: new Prisma.Decimal(0), // set below if openingBalance present
      gstin: row.gstin?.trim() || null,
      dlNumber: row.dlNumber?.trim() || null,
      registrationNumber: row.registrationNumber?.trim() || null,
      notes: row.notes?.trim() || null,
      whatsappOptIn: row.whatsappOptIn ?? true,
      whatsappNumber: row.whatsappNumber?.trim() || null,
      ...(branchId ? { branch: { connect: { id: branchId } } } : {}),
    };
  }

  private buildCustomerUpdateData(
    row: ImportCustomerDto,
  ): Prisma.CustomerUpdateInput {
    // UPDATE strategy: rewrite mutable fields from the workbook so the user
    // can correct stale customer details by re-importing. We do NOT touch
    // phone (it's the match key) or currentOutstanding (handled separately
    // via opening_balance) to avoid surprising side effects.
    const data: Prisma.CustomerUpdateInput = {};
    if (row.name?.trim()) data.name = row.name.trim();
    if (row.alternatePhone !== undefined)
      data.alternatePhone = row.alternatePhone?.trim() || null;
    if (row.email !== undefined) data.email = row.email?.trim() || null;
    if (row.address !== undefined) data.address = row.address?.trim() || null;
    if (row.type !== undefined) data.type = row.type;
    if (row.source !== undefined) data.source = row.source?.trim() || null;
    if (row.doctorRef !== undefined)
      data.doctorRef = row.doctorRef?.trim() || null;
    if (row.referredBy !== undefined)
      data.referredBy = row.referredBy?.trim() || null;
    if (row.creditLimit !== undefined)
      data.creditLimit = new Prisma.Decimal(row.creditLimit);
    if (row.gstin !== undefined) data.gstin = row.gstin?.trim() || null;
    if (row.dlNumber !== undefined)
      data.dlNumber = row.dlNumber?.trim() || null;
    if (row.registrationNumber !== undefined)
      data.registrationNumber = row.registrationNumber?.trim() || null;
    if (row.notes !== undefined) data.notes = row.notes?.trim() || null;
    if (row.whatsappOptIn !== undefined) data.whatsappOptIn = row.whatsappOptIn;
    if (row.whatsappNumber !== undefined)
      data.whatsappNumber = row.whatsappNumber?.trim() || null;
    return data;
  }

  private actionForHandling(
    h: ImportDuplicateHandling,
  ): ImportDuplicateMatch['action'] {
    if (h === 'UPDATE') return 'will-update';
    if (h === 'SKIP') return 'will-skip';
    return 'will-create-new';
  }

  private isCustomerType(v: unknown): v is CustomerType {
    return (
      typeof v === 'string' &&
      (Object.values(CustomerType) as string[]).includes(v)
    );
  }

  // Best-effort link to a real Product by name (case-insensitive, scoped to
  // branch or global) — same lookup pattern supplier-import.service.ts's
  // createBatch() already uses. Returns '' (unchanged historical behaviour)
  // when there's no match, so a typo'd/discontinued product name doesn't
  // fail the whole row — it just won't show in that product's history.
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

  // Schema enum is CASH | CARD | UPI | CREDIT | SPLIT. The workbook may use
  // legacy values like NEFT/CHEQUE/BANK — coerce to the closest match so the
  // import doesn't fail on a freeform mode label.
  private coercePaymentMode(
    raw: unknown,
  ): 'CASH' | 'CARD' | 'UPI' | 'CREDIT' | 'SPLIT' {
    const v = (typeof raw === 'string' ? raw : '').toUpperCase().trim();
    if (
      v === 'CASH' ||
      v === 'CARD' ||
      v === 'UPI' ||
      v === 'CREDIT' ||
      v === 'SPLIT'
    ) {
      return v;
    }
    if (
      v === 'CHEQUE' ||
      v === 'NEFT' ||
      v === 'IMPS' ||
      v === 'RTGS' ||
      v === 'BANK' ||
      v === 'BANK_TRANSFER'
    ) {
      return 'UPI'; // closest digital-payment bucket; reference number stored separately
    }
    return 'CASH';
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
      return `${fallback}: a record with the same unique field already exists (likely a duplicate invoice number).`;
    }
    return e?.message ? `${fallback}: ${e.message}` : fallback;
  }
}
