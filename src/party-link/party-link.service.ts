import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Customer, Supplier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePartyPhones, phonesFromLegacy } from '../common/utils/party-phones.util';

/**
 * Keeps a WHOLESALE customer and its supplier "twin" in lock-step so the same
 * real-world party shows up — and is usable — in BOTH the Customers and the
 * Suppliers directory. The FK lives on `Supplier.customerId` (unique 1:1);
 * `Customer.linkedSupplier` is the back-relation.
 *
 * Loop safety: every twin write here goes through RAW `prisma.*` — it never
 * calls SuppliersService/CustomersService, so a customer edit → sync-to-supplier
 * can never re-trigger a supplier edit → sync-to-customer. `syncTwinFields` also
 * writes only the fields that actually changed, so re-runs/backfills are no-ops.
 *
 * The two `currentOutstanding` ledgers stay independent (receivable on the
 * customer, payable on the supplier) — they are never synced.
 */
const norm = (p?: string | null): string => (p ?? '').replace(/\D/g, '');
const blankToNull = (v?: string | null): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};
const nullToBlank = (v?: string | null): string => (v ?? '').trim();
const isP2002 = (e: unknown): boolean =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

// The phone list a twin should carry. Normalised on the way across so a list
// hand-written into one side (or left over from before `phones` existed) can't
// reach the twin with two primaries, none, or duplicate numbers. Falls back to
// the flat columns for rows the backfill couldn't populate.
const twinPhones = (p: { phones: Prisma.JsonValue; phone: string; alternatePhone: string | null }): Prisma.InputJsonValue => {
  const list = normalizePartyPhones(p.phones);
  const resolved = list.length ? list : phonesFromLegacy(p.phone, p.alternatePhone);
  return resolved as unknown as Prisma.InputJsonValue;
};

// Compare two stored lists by value. Ordering is significant (it's the order the
// operator arranged them in) so a plain JSON compare of the normalised form is
// exactly the "did this actually change" test the only-if-changed sync needs.
const samePhones = (a: Prisma.JsonValue, b: Prisma.JsonValue): boolean =>
  JSON.stringify(normalizePartyPhones(a)) === JSON.stringify(normalizePartyPhones(b));

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PartyLinkService {
  private readonly logger = new Logger(PartyLinkService.name);

  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Db {
    return tx ?? this.prisma;
  }

  // Branch scope superset: same branch OR legacy global (null) rows, so a
  // null-branch counterpart still links rather than duplicates. Typed loosely so
  // it drops into both a Supplier and a Customer `where.OR`.
  private branchScope(branchId?: string | null): Array<{ branchId: string } | { branchId: null }> {
    return branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }];
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Ensure a WHOLESALE customer has a linked supplier twin (link an existing
   * unlinked supplier by GSTIN/phone, else create one). No-op for non-wholesale.
   * Returns the supplier id, or null.
   */
  async ensureSupplierTwin(customerId: string, tx?: Prisma.TransactionClient): Promise<string | null> {
    const db = this.db(tx);
    const customer = await db.customer.findUnique({
      where: { id: customerId },
      include: { linkedSupplier: { select: { id: true } } },
    });
    if (!customer || customer.type !== 'WHOLESALE') return null;
    if (customer.linkedSupplier) {
      await this.syncCustomerToSupplier(customer.id, tx);
      return customer.linkedSupplier.id;
    }

    const match = await this.findUnlinkedSupplier(customer, db);
    if (match) {
      try {
        await db.supplier.update({ where: { id: match.id }, data: { customerId: customer.id } });
      } catch (e) {
        if (!isP2002(e)) throw e;
      }
      await this.syncCustomerToSupplier(customer.id, tx);
      return match.id;
    }

    try {
      const created = await db.supplier.create({ data: this.supplierDataFromCustomer(customer) });
      return created.id;
    } catch (e) {
      if (isP2002(e)) {
        const existing = await db.supplier.findUnique({ where: { customerId: customer.id }, select: { id: true } });
        return existing?.id ?? null;
      }
      throw e;
    }
  }

  /**
   * Ensure a supplier has a linked WHOLESALE customer twin (link an existing
   * unlinked wholesale customer by GSTIN/phone, else create one).
   * Returns the customer id, or null.
   */
  async ensureCustomerTwin(supplierId: string, tx?: Prisma.TransactionClient): Promise<string | null> {
    const db = this.db(tx);
    const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) return null;
    if (supplier.customerId) {
      await this.syncSupplierToCustomer(supplier.id, tx);
      return supplier.customerId;
    }

    const match = await this.findUnlinkedWholesaleCustomer(supplier, db);
    if (match) {
      try {
        await db.supplier.update({ where: { id: supplier.id }, data: { customerId: match.id } });
      } catch (e) {
        if (!isP2002(e)) throw e;
      }
      await this.syncSupplierToCustomer(supplier.id, tx);
      return match.id;
    }

    const customer = await db.customer.create({ data: this.customerDataFromSupplier(supplier) });
    await db.supplier.update({ where: { id: supplier.id }, data: { customerId: customer.id } });
    return customer.id;
  }

  /** Propagate shared fields from the just-written entity onto its twin (if any). */
  async syncTwinFields(entity: 'customer' | 'supplier', id: string, tx?: Prisma.TransactionClient): Promise<void> {
    if (entity === 'customer') await this.syncCustomerToSupplier(id, tx);
    else await this.syncSupplierToCustomer(id, tx);
  }

  // ── Dedup lookups (link, don't duplicate) ─────────────────────

  private async findUnlinkedSupplier(
    customer: { gstin: string | null; phone: string; branchId: string | null },
    db: Db,
  ): Promise<{ id: string } | null> {
    const scope = this.branchScope(customer.branchId);
    const gstin = (customer.gstin ?? '').trim();
    if (gstin) {
      const byGstin = await db.supplier.findFirst({
        where: { gstin, customerId: null, OR: scope },
        select: { id: true },
      });
      if (byGstin) return byGstin;
    }
    const last10 = norm(customer.phone).slice(-10);
    if (last10) {
      const cands = await db.supplier.findMany({
        where: { phone: { contains: last10 }, customerId: null, OR: scope },
        select: { id: true, phone: true },
      });
      const hit = cands.find((s) => norm(s.phone) === norm(customer.phone));
      if (hit) return { id: hit.id };
    }
    return null;
  }

  private async findUnlinkedWholesaleCustomer(
    supplier: { gstin: string; phone: string; branchId: string | null },
    db: Db,
  ): Promise<{ id: string } | null> {
    const scope = this.branchScope(supplier.branchId);
    const gstin = (supplier.gstin ?? '').trim();
    if (gstin) {
      const byGstin = await db.customer.findFirst({
        where: { gstin, type: 'WHOLESALE', linkedSupplier: null, OR: scope },
        select: { id: true },
      });
      if (byGstin) return byGstin;
    }
    const last10 = norm(supplier.phone).slice(-10);
    if (last10) {
      const cands = await db.customer.findMany({
        where: { phone: { contains: last10 }, type: 'WHOLESALE', linkedSupplier: null, OR: scope },
        select: { id: true, phone: true },
      });
      const hit = cands.find((c) => norm(c.phone) === norm(supplier.phone));
      if (hit) return { id: hit.id };
    }
    return null;
  }

  // ── Row builders ──────────────────────────────────────────────

  private supplierDataFromCustomer(c: Customer): Prisma.SupplierUncheckedCreateInput {
    return {
      name: c.name,
      // Supplier requires contactPerson; use the customer's if set, else mirror name.
      contactPerson: (c.contactPerson ?? '').trim() || c.name,
      phone: norm(c.phone),
      email: nullToBlank(c.email),
      gstin: nullToBlank(c.gstin),
      drugLicense: nullToBlank(c.dlNumber),
      address: nullToBlank(c.address),
      paymentTerms: 'NET_30', // required enum; sane default (drives GRN due-date)
      // The twin is the same real-world party, so it gets the same numbers.
      // Normalised on the way across so a hand-edited list can't reach the twin
      // with two primaries (or none).
      phones: twinPhones(c),
      alternatePhone: c.alternatePhone ?? null,
      notes: c.notes ?? null,
      bankAccountName: c.bankAccountName ?? null,
      bankName: c.bankName ?? null,
      bankAccountNumber: c.bankAccountNumber ?? null,
      bankIfsc: c.bankIfsc ?? null,
      bankUpiId: c.bankUpiId ?? null,
      whatsappOptIn: c.whatsappOptIn,
      // blankToNull, not `?? null`: a blank override must not propagate to the
      // twin as "", which the WhatsApp senders would read as a real recipient
      // and use in place of `phone`. See common/utils/whatsapp-phone.util.
      whatsappNumber: blankToNull(c.whatsappNumber),
      branchId: c.branchId ?? null,
      currentOutstanding: 0, // fresh payable ledger
      customerId: c.id,
    };
  }

  private customerDataFromSupplier(s: Supplier): Prisma.CustomerUncheckedCreateInput {
    return {
      name: s.name,
      phone: norm(s.phone),
      type: 'WHOLESALE',
      email: blankToNull(s.email),
      gstin: blankToNull(s.gstin),
      dlNumber: blankToNull(s.drugLicense),
      address: blankToNull(s.address),
      contactPerson: (s.contactPerson ?? '').trim() || null,
      // See supplierDataFromCustomer — same numbers, same normalisation.
      phones: twinPhones(s),
      alternatePhone: s.alternatePhone ?? null,
      notes: s.notes ?? null,
      bankAccountName: s.bankAccountName ?? null,
      bankName: s.bankName ?? null,
      bankAccountNumber: s.bankAccountNumber ?? null,
      bankIfsc: s.bankIfsc ?? null,
      bankUpiId: s.bankUpiId ?? null,
      whatsappOptIn: s.whatsappOptIn,
      // See customerDataFromSupplier's twin above — blank never propagates.
      whatsappNumber: blankToNull(s.whatsappNumber),
      branchId: s.branchId ?? null,
      currentOutstanding: 0, // fresh receivable ledger
    };
  }

  // ── Only-if-changed sync ──────────────────────────────────────

  private async syncCustomerToSupplier(customerId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = this.db(tx);
    const c = await db.customer.findUnique({ where: { id: customerId }, include: { linkedSupplier: true } });
    const s = c?.linkedSupplier;
    if (!c || !s) return;
    const patch: Prisma.SupplierUpdateInput = {};
    if (s.name !== c.name) patch.name = c.name;
    if (norm(s.phone) !== norm(c.phone)) patch.phone = norm(c.phone);
    if ((s.email ?? '') !== nullToBlank(c.email)) patch.email = nullToBlank(c.email);
    if ((s.gstin ?? '') !== nullToBlank(c.gstin)) patch.gstin = nullToBlank(c.gstin);
    if ((s.drugLicense ?? '') !== nullToBlank(c.dlNumber)) patch.drugLicense = nullToBlank(c.dlNumber);
    if ((s.address ?? '') !== nullToBlank(c.address)) patch.address = nullToBlank(c.address);
    if (!samePhones(s.phones, c.phones)) patch.phones = twinPhones(c);
    if ((s.alternatePhone ?? null) !== (c.alternatePhone ?? null)) patch.alternatePhone = c.alternatePhone ?? null;
    if ((s.notes ?? null) !== (c.notes ?? null)) patch.notes = c.notes ?? null;
    const wantContact = (c.contactPerson ?? '').trim() || c.name; // supplier NOT NULL
    if (s.contactPerson !== wantContact) patch.contactPerson = wantContact;
    if ((s.bankAccountName ?? null) !== (c.bankAccountName ?? null)) patch.bankAccountName = c.bankAccountName ?? null;
    if ((s.bankName ?? null) !== (c.bankName ?? null)) patch.bankName = c.bankName ?? null;
    if ((s.bankAccountNumber ?? null) !== (c.bankAccountNumber ?? null)) patch.bankAccountNumber = c.bankAccountNumber ?? null;
    if ((s.bankIfsc ?? null) !== (c.bankIfsc ?? null)) patch.bankIfsc = c.bankIfsc ?? null;
    if ((s.bankUpiId ?? null) !== (c.bankUpiId ?? null)) patch.bankUpiId = c.bankUpiId ?? null;
    if (s.whatsappOptIn !== c.whatsappOptIn) patch.whatsappOptIn = c.whatsappOptIn;
    if ((s.whatsappNumber ?? null) !== blankToNull(c.whatsappNumber)) patch.whatsappNumber = blankToNull(c.whatsappNumber);
    if (Object.keys(patch).length) await db.supplier.update({ where: { id: s.id }, data: patch });
  }

  private async syncSupplierToCustomer(supplierId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = this.db(tx);
    const s = await db.supplier.findUnique({ where: { id: supplierId }, include: { customer: true } });
    const c = s?.customer;
    if (!s || !c) return;
    const patch: Prisma.CustomerUpdateInput = {};
    if (c.name !== s.name) patch.name = s.name;
    if (norm(c.phone) !== norm(s.phone)) patch.phone = norm(s.phone);
    if ((c.email ?? null) !== blankToNull(s.email)) patch.email = blankToNull(s.email);
    if ((c.gstin ?? null) !== blankToNull(s.gstin)) patch.gstin = blankToNull(s.gstin);
    if ((c.dlNumber ?? null) !== blankToNull(s.drugLicense)) patch.dlNumber = blankToNull(s.drugLicense);
    if ((c.address ?? null) !== blankToNull(s.address)) patch.address = blankToNull(s.address);
    if (!samePhones(c.phones, s.phones)) patch.phones = twinPhones(s);
    if ((c.alternatePhone ?? null) !== (s.alternatePhone ?? null)) patch.alternatePhone = s.alternatePhone ?? null;
    if ((c.notes ?? null) !== (s.notes ?? null)) patch.notes = s.notes ?? null;
    const wantContact = (s.contactPerson ?? '').trim() || null;
    if ((c.contactPerson ?? null) !== wantContact) patch.contactPerson = wantContact;
    if ((c.bankAccountName ?? null) !== (s.bankAccountName ?? null)) patch.bankAccountName = s.bankAccountName ?? null;
    if ((c.bankName ?? null) !== (s.bankName ?? null)) patch.bankName = s.bankName ?? null;
    if ((c.bankAccountNumber ?? null) !== (s.bankAccountNumber ?? null)) patch.bankAccountNumber = s.bankAccountNumber ?? null;
    if ((c.bankIfsc ?? null) !== (s.bankIfsc ?? null)) patch.bankIfsc = s.bankIfsc ?? null;
    if ((c.bankUpiId ?? null) !== (s.bankUpiId ?? null)) patch.bankUpiId = s.bankUpiId ?? null;
    if (c.whatsappOptIn !== s.whatsappOptIn) patch.whatsappOptIn = s.whatsappOptIn;
    if ((c.whatsappNumber ?? null) !== blankToNull(s.whatsappNumber)) patch.whatsappNumber = blankToNull(s.whatsappNumber);
    if (Object.keys(patch).length) await db.customer.update({ where: { id: c.id }, data: patch });
  }
}
