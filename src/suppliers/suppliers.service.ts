import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, PaymentTerms } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { PartyLinkService } from '../party-link/party-link.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly partyLink: PartyLinkService,
  ) {}

  /** Derive a GRN's payment status from how much has been paid vs the invoice. */
  private deriveGrnPaymentStatus(
    amountPaid: number,
    invoiceAmount: number,
  ): 'UNPAID' | 'PARTIAL' | 'PAID' {
    if (invoiceAmount <= 0 || amountPaid >= invoiceAmount - 0.01) return 'PAID';
    if (amountPaid <= 0.01) return 'UNPAID';
    return 'PARTIAL';
  }

  // Strip everything except digits so "9876543210", "(987) 654-3210", and
  // "+91 98765 43210" collapse to a comparable form. Mirrors customers.service
  // so cross-record lookups behave consistently.
  private normalizePhone(phone: string | null | undefined): string {
    if (!phone) return '';
    return phone.replace(/\D/g, '');
  }

  // Reject suppliers that duplicate an existing one within the same branch
  // scope on phone (digits-only) or GSTIN. Suppliers are per-branch master
  // data — HQ and BR1 each maintain their own row for the same legal supplier
  // so phone/GSTIN uniqueness is naturally branch-scoped too.
  private async assertNoDuplicate(
    data: { phone?: string; gstin?: string; drugLicense?: string; branchId?: string | null },
    excludeId?: string,
  ) {
    const normalizedPhone = this.normalizePhone(data.phone);
    const branchScope = data.branchId
      ? [{ branchId: data.branchId }, { branchId: null }]
      : [{ branchId: null }];

    if (data.gstin) {
      const gstinDup = await this.prisma.supplier.findFirst({
        where: {
          AND: [
            { gstin: data.gstin },
            { OR: branchScope },
            ...(excludeId ? [{ id: { not: excludeId } }] : []),
          ],
        },
        select: { id: true, name: true },
      });
      if (gstinDup) {
        throw new ConflictException(
          `Another supplier (${gstinDup.name}) already uses GSTIN ${data.gstin} in this branch.`,
        );
      }
    }

    // Drug licence numbers are unique per real supplier too — guard against a
    // second supplier reusing one. Compared case-insensitively so "dl-20b" and
    // "DL-20B" collide. Empty string (the column default) is skipped.
    if (data.drugLicense && data.drugLicense.trim()) {
      const dl = data.drugLicense.trim();
      const dlDup = await this.prisma.supplier.findFirst({
        where: {
          AND: [
            { drugLicense: { equals: dl, mode: 'insensitive' } },
            { OR: branchScope },
            ...(excludeId ? [{ id: { not: excludeId } }] : []),
          ],
        },
        select: { id: true, name: true },
      });
      if (dlDup) {
        throw new ConflictException(
          `Another supplier (${dlDup.name}) already uses Drug License ${dl} in this branch.`,
        );
      }
    }

    if (normalizedPhone) {
      // Match candidates whose digits-only phone matches the last 10 chars
      // (Indian mobile length).
      const last10 = normalizedPhone.slice(-10);
      const candidate = await this.prisma.supplier.findFirst({
        where: {
          AND: [
            { phone: { contains: last10 } },
            { OR: branchScope },
            ...(excludeId ? [{ id: { not: excludeId } }] : []),
          ],
        },
        select: { id: true, name: true, phone: true },
      });
      if (candidate && this.normalizePhone(candidate.phone) === normalizedPhone) {
        throw new ConflictException(
          `Another supplier (${candidate.name}) already uses this phone in this branch.`,
        );
      }
    }
  }

  // Belt-and-braces name guard. DTO `@IsNotEmpty()` already rejects empty
  // strings at the controller boundary, but historical data showed three
  // orphan supplier rows with name="" that surfaced in the directory as
  // "Admin · phone" subtitles (the row's contactPerson rendered first).
  // Catching it here covers any internal caller that bypasses class-validator.
  private assertNameNonEmpty(name: string | null | undefined) {
    if (!name || !String(name).trim()) {
      throw new BadRequestException('Supplier name is required.');
    }
  }

  async create(createSupplierDto: CreateSupplierDto & { branchId?: string }) {
    this.assertNameNonEmpty(createSupplierDto.name);
    const dto = {
      ...createSupplierDto,
      name: createSupplierDto.name.trim(),
      phone: this.normalizePhone(createSupplierDto.phone),
      // Payment terms was removed from the Add-Supplier form; default it so the
      // required column + the GRN due-date logic (termDays) keep working.
      paymentTerms: createSupplierDto.paymentTerms ?? PaymentTerms.NET_30,
    };
    await this.assertNoDuplicate({
      phone: dto.phone,
      gstin: dto.gstin,
      drugLicense: dto.drugLicense,
      branchId: dto.branchId ?? null,
    });
    const created = await this.prisma.supplier.create({ data: dto });
    // Mirror to a linked wholesale-customer twin. Best-effort — a twin hiccup
    // must never fail the supplier create (the backfill script catches misses).
    let twinCustomerId: string | null = created.customerId;
    try {
      twinCustomerId = (await this.partyLink.ensureCustomerTwin(created.id)) ?? twinCustomerId;
    } catch (e) {
      this.logger.warn(`Party-link twin failed for supplier ${created.id}: ${String(e)}`);
    }
    // Surface the twin's customerId in the response so the form can attach the
    // party's documents (address proof, etc.) to the shared customer record.
    return { ...created, customerId: twinCustomerId };
  }

  // Live availability check for the Add/Edit form — lets the UI flag a taken
  // GSTIN / drug licence AS THE USER TYPES instead of only on submit. Returns
  // the conflicting supplier's name per field so the form can name it inline.
  async checkDuplicate(
    branchId: string | undefined,
    opts: { gstin?: string; drugLicense?: string; excludeId?: string },
  ) {
    const branchScope = branchId
      ? [{ branchId }, { branchId: null }]
      : [{ branchId: null }];
    const notSelf = opts.excludeId ? [{ id: { not: opts.excludeId } }] : [];

    const result: {
      gstin?: { taken: boolean; name: string };
      drugLicense?: { taken: boolean; name: string };
    } = {};

    const gstin = opts.gstin?.trim();
    if (gstin) {
      const dup = await this.prisma.supplier.findFirst({
        where: { AND: [{ gstin }, { OR: branchScope }, ...notSelf] },
        select: { name: true },
      });
      if (dup) result.gstin = { taken: true, name: dup.name };
    }

    const dl = opts.drugLicense?.trim();
    if (dl) {
      const dup = await this.prisma.supplier.findFirst({
        where: {
          AND: [
            { drugLicense: { equals: dl, mode: 'insensitive' } },
            { OR: branchScope },
            ...notSelf,
          ],
        },
        select: { name: true },
      });
      if (dup) result.drugLicense = { taken: true, name: dup.name };
    }

    return result;
  }

  async bulkCreate(suppliers: CreateSupplierDto[], branchId?: string) {
    let createdCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Pre-fetch existing for this branch to validate in memory
    const branchScope = branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }];
    const existingSuppliers = await this.prisma.supplier.findMany({
      where: { OR: branchScope },
      select: { gstin: true, phone: true }
    });

    const existingGstins = new Set(existingSuppliers.map(s => s.gstin).filter(Boolean));
    const existingPhones = new Set(existingSuppliers.map(s => this.normalizePhone(s.phone)).filter(Boolean));

    const toCreate = [];

    for (const [index, s] of suppliers.entries()) {
      try {
        this.assertNameNonEmpty(s.name);
        const normalizedPhone = this.normalizePhone(s.phone);

        if (s.gstin && existingGstins.has(s.gstin)) {
          throw new ConflictException(`GSTIN ${s.gstin} already exists.`);
        }
        
        if (normalizedPhone) {
          const last10 = normalizedPhone.slice(-10);
          const isDup = Array.from(existingPhones).some(p => p.endsWith(last10));
          if (isDup) {
             throw new ConflictException(`Phone ending in ${last10} already exists.`);
          }
        }
        
        if (s.gstin) existingGstins.add(s.gstin);
        if (normalizedPhone) existingPhones.add(normalizedPhone);
        
        toCreate.push({
          ...s,
          name: s.name.trim(),
          phone: normalizedPhone,
          paymentTerms: s.paymentTerms ?? PaymentTerms.NET_30,
          branchId: branchId ?? null,
        });
      } catch (err: any) {
        skippedCount++;
        errors.push(`Row ${index + 1} (${s.name}): ${err.message}`);
      }
    }

    if (toCreate.length > 0) {
      await this.prisma.supplier.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      createdCount = toCreate.length;
    }

    return { createdCount, skippedCount, errors };
  }

  async findAll(
    query?: string,
    branchId?: string,
    skip?: number,
    take?: number,
    filters?: {
      isActive?: boolean;
      paymentTerms?: string;
      hasGstin?: boolean;
      outstandingMin?: number;
      outstandingMax?: number;
      paymentStatus?: 'PAID' | 'PARTIAL' | 'UNPAID';
    },
  ) {
    const conditions: Prisma.SupplierWhereInput[] = [];

    // Branch filter: include the requested branch + global (null) suppliers
    // (legacy rows that pre-date branch-scoping).
    if (branchId && branchId !== 'all') {
      conditions.push({
        OR: [{ branchId }, { branchId: null }],
      });
    }

    if (query) {
      conditions.push({
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { gstin: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
          { email: { contains: query, mode: 'insensitive' } },
          { address: { contains: query, mode: 'insensitive' } },
          { contactPerson: { contains: query, mode: 'insensitive' } },
        ],
      });
    }

    if (filters) {
      if (typeof filters.isActive === 'boolean') {
        conditions.push({ isActive: filters.isActive });
      }
      if (filters.paymentTerms) {
        // Prisma accepts the string value of the enum directly.
        conditions.push({ paymentTerms: filters.paymentTerms as any });
      }
      if (typeof filters.hasGstin === 'boolean') {
        // `gstin` is a non-nullable String on Supplier (defaults to ''), so the
        // presence check is purely empty-vs-non-empty. Filtering on `null` here
        // makes Prisma reject the query ("Argument `gstin` is missing").
        conditions.push(
          filters.hasGstin ? { gstin: { not: '' } } : { gstin: '' },
        );
      }
      if (
        typeof filters.outstandingMin === 'number' ||
        typeof filters.outstandingMax === 'number'
      ) {
        const outstanding: any = {};
        if (typeof filters.outstandingMin === 'number') outstanding.gte = filters.outstandingMin;
        if (typeof filters.outstandingMax === 'number') outstanding.lte = filters.outstandingMax;
        conditions.push({ currentOutstanding: outstanding });
      }
    }

    // Payment-status folder (Paid / Partial / Unpaid) is derived from live GRN
    // aggregates, not a column, so we resolve the matching supplier ids first
    // (over the pre-status where) and then constrain the id set. This keeps the
    // filter server-side so the tab counts and pagination reflect ALL matches,
    // not just the loaded pages.
    if (filters?.paymentStatus) {
      const preStatusWhere: Prisma.SupplierWhereInput =
        conditions.length > 0 ? { AND: [...conditions] } : {};
      const buckets = await this.supplierPaymentStatusIds(preStatusWhere, branchId);
      const ids =
        filters.paymentStatus === 'PAID'
          ? buckets.paid
          : filters.paymentStatus === 'PARTIAL'
            ? buckets.partial
            : buckets.unpaid;
      conditions.push({ id: { in: ids } });
    }

    const where: Prisma.SupplierWhereInput =
      conditions.length > 0 ? { AND: conditions } : {};

    const paginated = typeof skip === 'number' && typeof take === 'number';
    const safeTake = paginated ? Math.min(Math.max(take, 1), 100) : undefined;
    const safeSkip = paginated ? Math.max(skip, 0) : undefined;

    if (!paginated) {
      const all = await this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
      });
      return this.withLiveOutstanding(this.rankByRelevance(all, query), branchId);
    }

    // With a search query, rank NAME matches ahead of matches that only hit
    // another field (address, email, contact person, …). The `where` OR-clause
    // still lets those through, but a supplier whose name doesn't contain the
    // query — e.g. "ABHAY PHARMA" surfacing for "hospital" because its address
    // reads "NR.SM HOSPITAL" — sorts below every real name match. Search result
    // sets are small, so we rank the full match set in memory and slice it for
    // pagination; that keeps page order stable across infinite scroll.
    if (query) {
      const matches = await this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
      });
      const ranked = this.rankByRelevance(matches, query);
      const total = ranked.length;
      const pageRows = ranked.slice(safeSkip!, safeSkip! + safeTake!);
      return {
        data: await this.withLiveOutstanding(pageRows, branchId),
        total,
        hasMore: (safeSkip ?? 0) + pageRows.length < total,
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: safeSkip,
        take: safeTake,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return {
      data: await this.withLiveOutstanding(data, branchId),
      total,
      hasMore: (safeSkip ?? 0) + data.length < total,
    };
  }

  // Stable relevance ordering for search results. Lower score = more relevant:
  //   0 = name is exactly the query
  //   1 = name STARTS WITH the query   (e.g. "Santhosh" for "santh")
  //   2 = name CONTAINS the query      (e.g. "JayaSANTHi" for "santh")
  //   3 = matched only via another field (address / email / phone / GSTIN /
  //       contact person)
  // Input is already sorted by name and Array.sort is stable, so ties break
  // alphabetically within each tier. No-op without a query.
  private rankByRelevance<T extends { name: string }>(rows: T[], query?: string): T[] {
    const q = (query ?? '').trim().toLowerCase();
    if (!q) return rows;
    const score = (s: T): number => {
      const name = (s.name ?? '').toLowerCase();
      if (name === q) return 0;
      if (name.startsWith(q)) return 1;
      if (name.includes(q)) return 2;
      return 3;
    };
    return [...rows].sort((a, b) => score(a) - score(b));
  }

  // Overrides each supplier's `currentOutstanding` with the LIVE balance
  // computed from open GRNs — the exact same basis as getOutstanding() — so
  // the Suppliers list and the Outstanding aging page always agree. The
  // stored `currentOutstanding` column is a denormalized cache that can drift
  // (e.g. legacy/seeded GRNs created outside the increment flow); deriving the
  // displayed value live makes the list immune to that drift.
  private async withLiveOutstanding<T extends { id: string; currentOutstanding: unknown }>(
    suppliers: T[],
    branchId?: string,
  ): Promise<Array<T & { totalPurchases: number; paidAmount: number }>> {
    if (suppliers.length === 0)
      return suppliers as Array<T & { totalPurchases: number; paidAmount: number }>;
    // One pass over every non-replacement GRN gives all three figures: total
    // purchased (Σ invoice), paid (Σ amountPaid), and the live outstanding (the
    // still-positive due on UNPAID/PARTIAL GRNs — the canonical balance, same
    // basis as getOutstanding()).
    const grns = await this.prisma.gRN.findMany({
      where: {
        supplierId: { in: suppliers.map((s) => s.id) },
        isReplacement: false,
        ...(branchId ? { branchId } : {}),
      },
      select: {
        supplierId: true,
        supplierInvoiceAmount: true,
        amountPaid: true,
        paymentStatus: true,
      },
    });
    const outMap = new Map<string, number>();
    const totalMap = new Map<string, number>();
    const paidMap = new Map<string, number>();
    for (const g of grns) {
      const inv = Number(g.supplierInvoiceAmount);
      const paid = Number(g.amountPaid);
      totalMap.set(g.supplierId, (totalMap.get(g.supplierId) ?? 0) + inv);
      paidMap.set(g.supplierId, (paidMap.get(g.supplierId) ?? 0) + paid);
      if (g.paymentStatus === 'UNPAID' || g.paymentStatus === 'PARTIAL') {
        const due = inv - paid;
        if (due > 0.01)
          outMap.set(g.supplierId, (outMap.get(g.supplierId) ?? 0) + due);
      }
    }
    return suppliers.map((s) => ({
      ...s,
      currentOutstanding: outMap.get(s.id) ?? 0,
      totalPurchases: totalMap.get(s.id) ?? 0,
      paidAmount: paidMap.get(s.id) ?? 0,
    }));
  }

  // Classifies every supplier matching `where` into Paid / Partial / Unpaid
  // folders using the same live-GRN basis as withLiveOutstanding(). Suppliers
  // that have never been billed (no real GRN / zero invoiced) are excluded from
  // all three buckets — they belong to "All" only. Returns the supplier ids per
  // bucket so both findAll (filtering) and summary (counts) share one source.
  private async supplierPaymentStatusIds(
    where: Prisma.SupplierWhereInput,
    branchId?: string,
  ): Promise<{ paid: string[]; partial: string[]; unpaid: string[] }> {
    const buckets = { paid: [] as string[], partial: [] as string[], unpaid: [] as string[] };
    const suppliers = await this.prisma.supplier.findMany({
      where,
      select: { id: true },
    });
    const ids = suppliers.map((s) => s.id);
    if (ids.length === 0) return buckets;

    const grns = await this.prisma.gRN.findMany({
      where: {
        supplierId: { in: ids },
        isReplacement: false,
        ...(branchId && branchId !== 'all' ? { branchId } : {}),
      },
      select: {
        supplierId: true,
        supplierInvoiceAmount: true,
        amountPaid: true,
        paymentStatus: true,
      },
    });
    const totalMap = new Map<string, number>();
    const paidMap = new Map<string, number>();
    const outMap = new Map<string, number>();
    for (const g of grns) {
      const inv = Number(g.supplierInvoiceAmount);
      const paid = Number(g.amountPaid);
      totalMap.set(g.supplierId, (totalMap.get(g.supplierId) ?? 0) + inv);
      paidMap.set(g.supplierId, (paidMap.get(g.supplierId) ?? 0) + paid);
      if (g.paymentStatus === 'UNPAID' || g.paymentStatus === 'PARTIAL') {
        const due = inv - paid;
        if (due > 0.01)
          outMap.set(g.supplierId, (outMap.get(g.supplierId) ?? 0) + due);
      }
    }

    for (const id of ids) {
      const billed = totalMap.get(id) ?? 0;
      if (billed <= 0) continue; // never purchased → not in any payment folder
      const outstanding = outMap.get(id) ?? 0;
      if (outstanding <= 0.01) buckets.paid.push(id);
      else if ((paidMap.get(id) ?? 0) > 0) buckets.partial.push(id);
      else buckets.unpaid.push(id);
    }
    return buckets;
  }

  // Directory-wide KPIs for the Suppliers page stat cards. Both figures come
  // from GRNs (the system of record for what was purchased and what's still
  // owed), excluding replacement GRNs (₹0 money-neutral receipts).
  async summary(
    branchId?: string,
    filters?: {
      q?: string;
      isActive?: boolean;
      paymentTerms?: string;
      hasGstin?: boolean;
      outstandingMin?: number;
      outstandingMax?: number;
    },
  ) {
    // Same supplier WHERE as findAll() so the stat cards reflect exactly the
    // set the operator has filtered to (status / terms / GSTIN / outstanding).
    const conditions: Prisma.SupplierWhereInput[] = [];
    if (branchId && branchId !== 'all') {
      conditions.push({ OR: [{ branchId }, { branchId: null }] });
    }
    if (filters?.q) {
      conditions.push({
        OR: [
          { name: { contains: filters.q, mode: 'insensitive' } },
          { gstin: { contains: filters.q, mode: 'insensitive' } },
          { phone: { contains: filters.q } },
          { address: { contains: filters.q, mode: 'insensitive' } },
          { contactPerson: { contains: filters.q, mode: 'insensitive' } },
        ],
      });
    }
    if (typeof filters?.isActive === 'boolean') {
      conditions.push({ isActive: filters.isActive });
    }
    if (filters?.paymentTerms) {
      conditions.push({
        paymentTerms:
          filters.paymentTerms as Prisma.SupplierWhereInput['paymentTerms'],
      });
    }
    if (typeof filters?.hasGstin === 'boolean') {
      conditions.push(
        filters.hasGstin ? { NOT: [{ gstin: '' }] } : { OR: [{ gstin: '' }] },
      );
    }
    if (typeof filters?.outstandingMin === 'number') {
      conditions.push({ currentOutstanding: { gte: filters.outstandingMin } });
    }
    if (typeof filters?.outstandingMax === 'number') {
      conditions.push({ currentOutstanding: { lte: filters.outstandingMax } });
    }
    const where: Prisma.SupplierWhereInput =
      conditions.length > 0 ? { AND: conditions } : {};

    const suppliers = await this.prisma.supplier.findMany({
      where,
      select: { id: true, isActive: true },
    });
    const ids = suppliers.map((s) => s.id);
    const totalCount = suppliers.length;
    const activeCount = suppliers.filter((s) => s.isActive).length;
    const inactiveCount = totalCount - activeCount;

    // Money KPIs scoped to the filtered supplier set.
    const grnScope = { isReplacement: false, supplierId: { in: ids } };
    const [purchased, pending] = await Promise.all([
      // Total Purchases — everything ever billed by these suppliers.
      this.prisma.gRN.aggregate({
        where: grnScope,
        _sum: { supplierInvoiceAmount: true },
      }),
      // Pending Payments — still-open balance on UNPAID / PARTIAL GRNs.
      this.prisma.gRN.aggregate({
        where: { ...grnScope, paymentStatus: { in: ['UNPAID', 'PARTIAL'] } },
        _sum: { supplierInvoiceAmount: true, amountPaid: true },
      }),
    ]);
    const totalPurchases = Number(purchased._sum.supplierInvoiceAmount ?? 0);
    const pendingPayments = Math.max(
      0,
      Number(pending._sum.supplierInvoiceAmount ?? 0) -
        Number(pending._sum.amountPaid ?? 0),
    );

    // Payment-status folder counts over the SAME filtered set, so the tabs show
    // true totals across all pages (not just the loaded ones).
    const buckets = await this.supplierPaymentStatusIds(where, branchId);

    return {
      totalCount,
      activeCount,
      inactiveCount,
      totalPurchases,
      pendingPayments,
      paidCount: buckets.paid.length,
      partialCount: buckets.partial.length,
      unpaidCount: buckets.unpaid.length,
    };
  }

  async findOne(id: string, branchId?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        batches: {
          // Include product name so the supplier-detail Batches tab can render
          // it without a separate fetch / client-side join.
          include: { product: { select: { name: true } } },
          orderBy: { expiryDate: 'asc' },
        },
        purchaseOrders: { take: 10, orderBy: { date: 'desc' } },
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    if (branchId && supplier.branchId && supplier.branchId !== branchId) {
      throw new NotFoundException('Supplier not found');
    }
    return supplier;
  }

  // Suppliers with an unpaid balance + aging buckets, computed live from open
  // GRN balances. Mirrors customers.service.getOutstanding. Aging is by GRN
  // date (days since received) — simple and consistent with the customer view.
  async getOutstanding(
    branchId?: string,
    filters?: {
      q?: string;
      bucket?: 'current' | '0-30' | '31-60' | '61-90' | '90+';
      minOutstanding?: number;
    },
  ) {
    const grns = await this.prisma.gRN.findMany({
      where: {
        isReplacement: false,
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        date: true,
        supplierId: true,
        supplierName: true,
        supplierInvoiceAmount: true,
        amountPaid: true,
      },
      orderBy: { date: 'asc' },
    });

    const now = Date.now();
    const map = new Map<
      string,
      {
        supplierId: string;
        supplier: string;
        outstanding: number;
        current: number;
        d0_30: number;
        d31_60: number;
        d61_90: number;
        d90plus: number;
        grnCount: number;
      }
    >();

    for (const g of grns) {
      const due = Number(g.supplierInvoiceAmount) - Number(g.amountPaid);
      if (due <= 0.01) continue;
      const entry = map.get(g.supplierId) ?? {
        supplierId: g.supplierId,
        supplier: g.supplierName,
        outstanding: 0,
        current: 0,
        d0_30: 0,
        d31_60: 0,
        d61_90: 0,
        d90plus: 0,
        grnCount: 0,
      };
      const ageDays = Math.floor((now - new Date(g.date).getTime()) / 86400000);
      if (ageDays <= 0) entry.current += due;
      else if (ageDays <= 30) entry.d0_30 += due;
      else if (ageDays <= 60) entry.d31_60 += due;
      else if (ageDays <= 90) entry.d61_90 += due;
      else entry.d90plus += due;
      entry.outstanding += due;
      entry.grnCount += 1;
      map.set(g.supplierId, entry);
    }

    let rows = Array.from(map.values()).map((e) => ({
      supplierId: e.supplierId,
      supplier: e.supplier,
      outstanding: e.outstanding,
      current: e.current,
      '0-30': e.d0_30,
      '31-60': e.d31_60,
      '61-90': e.d61_90,
      '90+': e.d90plus,
      grnCount: e.grnCount,
    }));

    if (filters?.q) {
      const q = filters.q.toLowerCase();
      rows = rows.filter((r) => r.supplier.toLowerCase().includes(q));
    }
    if (filters?.bucket) {
      rows = rows.filter((r) => r[filters.bucket!] > 0);
    }
    if (typeof filters?.minOutstanding === 'number' && filters.minOutstanding > 0) {
      rows = rows.filter((r) => r.outstanding >= filters.minOutstanding!);
    }

    rows.sort((a, b) => b.outstanding - a.outstanding);

    return {
      total: rows.reduce((s, r) => s + r.outstanding, 0),
      rows,
    };
  }

  // Per-supplier drill-down for the Outstanding page drawer: each open GRN with
  // its unpaid balance + age in days, oldest-first (matches recordPayment FIFO).
  async getSupplierOutstandingGrns(supplierId: string, branchId?: string) {
    const grns = await this.prisma.gRN.findMany({
      where: {
        supplierId,
        isReplacement: false,
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        grnNumber: true,
        date: true,
        dueDate: true,
        supplierInvoiceNo: true,
        supplierInvoiceAmount: true,
        amountPaid: true,
        paymentStatus: true,
      },
      orderBy: { date: 'asc' },
    });

    const now = Date.now();
    return grns
      .map((g) => {
        const invoiceAmount = Number(g.supplierInvoiceAmount);
        const amountPaid = Number(g.amountPaid);
        const balance = invoiceAmount - amountPaid;
        const daysOverdue = Math.max(
          0,
          Math.floor((now - new Date(g.date).getTime()) / 86400000),
        );
        return {
          id: g.id,
          grnNumber: g.grnNumber,
          date: g.date,
          dueDate: g.dueDate,
          supplierInvoiceNo: g.supplierInvoiceNo,
          invoiceAmount,
          amountPaid,
          balance,
          status: g.paymentStatus,
          daysOverdue,
        };
      })
      .filter((g) => g.balance > 0.01);
  }

  // Credit-term length in days for a supplier, used to derive a fallback due
  // date when a GRN has no explicit dueDate (legacy / older credit purchases).
  private termDays(terms?: string | null): number {
    switch (terms) {
      case 'NET_45':
        return 45;
      case 'NET_60':
        return 60;
      case 'NET_30':
      default:
        return 30;
    }
  }

  // "Supplier Payments Due" — the payables counterpart to the customer Due inbox.
  // A flat, due-date-sorted list of every open (UNPAID/PARTIAL) credit GRN with
  // its outstanding balance, keyed off GRN.dueDate. Where a GRN has no explicit
  // dueDate (older entries), it falls back to grnDate + the supplier's credit
  // term (NET_30/45/60) — mirroring reports.service.effectiveDueDate on the
  // customer side. Each row is classed overdue / due-soon (≤7 days) / upcoming.
  async getPaymentsDue(
    branchId?: string,
    filters?: { q?: string; status?: 'overdue' | 'due-soon' | 'upcoming' | 'all' },
  ) {
    const grns = await this.prisma.gRN.findMany({
      where: {
        isReplacement: false,
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        grnNumber: true,
        date: true,
        dueDate: true,
        supplierId: true,
        supplierName: true,
        supplierInvoiceNo: true,
        supplierInvoiceAmount: true,
        amountPaid: true,
        paymentStatus: true,
        supplier: { select: { paymentTerms: true } },
      },
    });

    const now = Date.now();
    const DUE_SOON_DAYS = 7;
    const round2 = (n: number) => Math.round(n * 100) / 100;

    let rows = grns
      .map((g) => {
        const balance = round2(
          Number(g.supplierInvoiceAmount) - Number(g.amountPaid),
        );
        if (balance <= 0.01) return null;
        const explicitDueDate = !!g.dueDate;
        const effectiveDue = g.dueDate
          ? new Date(g.dueDate)
          : new Date(
              new Date(g.date).getTime() +
                this.termDays(g.supplier?.paymentTerms) * 86400000,
            );
        const daysPastDue = Math.floor(
          (now - effectiveDue.getTime()) / 86400000,
        );
        const bucket: 'overdue' | 'due-soon' | 'upcoming' =
          daysPastDue > 0
            ? 'overdue'
            : daysPastDue >= -DUE_SOON_DAYS
              ? 'due-soon'
              : 'upcoming';
        return {
          grnId: g.id,
          grnNumber: g.grnNumber,
          supplierId: g.supplierId,
          supplierName: g.supplierName,
          supplierInvoiceNo: g.supplierInvoiceNo,
          grnDate: g.date,
          dueDate: effectiveDue,
          explicitDueDate,
          balance,
          daysPastDue,
          status: g.paymentStatus,
          bucket,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Most-overdue first (earliest due date at the top).
    rows.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

    // Summary over ALL due rows (computed before q/status narrowing so the KPI
    // cards stay stable while the user filters the table).
    const summary = {
      overdueAmount: 0,
      overdueCount: 0,
      dueSoonAmount: 0,
      dueSoonCount: 0,
      upcomingAmount: 0,
      upcomingCount: 0,
      totalDue: 0,
      totalCount: 0,
    };
    for (const r of rows) {
      summary.totalDue += r.balance;
      summary.totalCount += 1;
      if (r.bucket === 'overdue') {
        summary.overdueAmount += r.balance;
        summary.overdueCount += 1;
      } else if (r.bucket === 'due-soon') {
        summary.dueSoonAmount += r.balance;
        summary.dueSoonCount += 1;
      } else {
        summary.upcomingAmount += r.balance;
        summary.upcomingCount += 1;
      }
    }
    summary.overdueAmount = round2(summary.overdueAmount);
    summary.dueSoonAmount = round2(summary.dueSoonAmount);
    summary.upcomingAmount = round2(summary.upcomingAmount);
    summary.totalDue = round2(summary.totalDue);

    if (filters?.q) {
      const q = filters.q.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.supplierName.toLowerCase().includes(q) ||
          (r.supplierInvoiceNo ?? '').toLowerCase().includes(q),
      );
    }
    if (filters?.status && filters.status !== 'all') {
      rows = rows.filter((r) => r.bucket === filters.status);
    }

    return { summary, rows };
  }

  // Record a payment we made to a supplier — the credit side of the supplier
  // ledger. Mirrors customers.service.recordPayment: allocate FIFO across the
  // supplier's open (UNPAID/PARTIAL) GRNs, or to specific GRNs when grnIds is
  // given. Each touched GRN's amountPaid/paymentStatus advances; the supplier's
  // currentOutstanding drops by the amount actually applied; one SupplierPayment
  // record is written for the whole collection.
  async recordPayment(
    id: string,
    amount: number,
    paymentMode: string,
    referenceNumber?: string,
    branchId?: string,
    grnIds?: string[],
  ) {
    return this.numbering.retryOnCollision(() =>
      this.recordPaymentInternal(id, amount, paymentMode, referenceNumber, branchId, grnIds),
    );
  }

  private async recordPaymentInternal(
    id: string,
    amount: number,
    paymentMode: string,
    referenceNumber?: string,
    branchId?: string,
    grnIds?: string[],
  ) {
    if (amount <= 0)
      throw new BadRequestException('Amount must be greater than zero');

    const supplier = await this.findOne(id, branchId);

    const useSpecific = Array.isArray(grnIds) && grnIds.length > 0;

    const openGrns = await this.prisma.gRN.findMany({
      where: {
        supplierId: id,
        isReplacement: false,
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        ...(useSpecific ? { id: { in: grnIds } } : {}),
      },
      orderBy: { date: 'asc' },
    });

    if (openGrns.length === 0) {
      throw new BadRequestException(
        useSpecific
          ? 'Selected GRNs are not open or do not belong to this supplier'
          : 'No outstanding GRNs for this supplier',
      );
    }

    if (grnIds && useSpecific && openGrns.length !== grnIds.length) {
      throw new BadRequestException(
        'One or more selected GRNs are not open or do not belong to this supplier',
      );
    }

    const totalOutstanding = openGrns.reduce(
      (s, g) => s + Number(g.supplierInvoiceAmount) - Number(g.amountPaid),
      0,
    );

    if (amount > totalOutstanding + 0.01) {
      throw new BadRequestException(
        useSpecific
          ? `Payment amount (₹${amount.toFixed(2)}) exceeds balance of selected GRNs (₹${totalOutstanding.toFixed(2)})`
          : `Payment amount (₹${amount.toFixed(2)}) exceeds outstanding balance (₹${totalOutstanding.toFixed(2)})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      let remaining = amount;
      const allocations: {
        grnId: string;
        applied: number;
        newStatus: string;
      }[] = [];

      for (const g of openGrns) {
        if (remaining <= 0.01) break;
        const due = Number(g.supplierInvoiceAmount) - Number(g.amountPaid);
        if (due <= 0.01) continue;
        const applied = Math.min(remaining, due);
        const newAmountPaid = Number(g.amountPaid) + applied;
        const newStatus = this.deriveGrnPaymentStatus(
          newAmountPaid,
          Number(g.supplierInvoiceAmount),
        );

        await tx.gRN.update({
          where: { id: g.id },
          data: { amountPaid: newAmountPaid, paymentStatus: newStatus },
        });

        allocations.push({ grnId: g.id, applied, newStatus });
        remaining -= applied;
      }

      // Decrement supplier outstanding by the amount actually applied.
      const totalApplied = amount - Math.max(0, remaining);
      await tx.supplier.update({
        where: { id },
        data: { currentOutstanding: { decrement: totalApplied } },
      });

      const paymentNumber = await this.numbering.nextNumber(
        tx,
        'SPAY',
        supplier.branchId ?? branchId ?? null,
      );

      const payment = await tx.supplierPayment.create({
        data: {
          paymentNumber,
          supplierId: id,
          // link to the single GRN touched, else null (lump payment)
          grnId: allocations.length === 1 ? allocations[0].grnId : null,
          amount: totalApplied,
          paymentMode,
          referenceNumber: referenceNumber ?? null,
          branchId: supplier.branchId ?? branchId ?? null,
        },
      });

      return {
        paymentNumber: payment.paymentNumber,
        amount: totalApplied,
        allocations,
      };
    });
  }

  // Bulk export for the Export → edit → Re-import workflow. Returns the full
  // data tree (suppliers + every history entity) so the client can build a
  // workbook matching the import template.
  async exportData(
    branchId?: string,
    filters?: {
      q?: string;
      isActive?: boolean;
      paymentTerms?: string;
      hasGstin?: boolean;
      outstandingMin?: number;
      outstandingMax?: number;
    },
  ) {
    const conditions: Prisma.SupplierWhereInput[] = [];
    if (branchId && branchId !== 'all') {
      conditions.push({ OR: [{ branchId }, { branchId: null }] });
    }
    if (filters?.q) {
      conditions.push({
        OR: [
          { name: { contains: filters.q, mode: 'insensitive' } },
          { gstin: { contains: filters.q, mode: 'insensitive' } },
          { phone: { contains: filters.q } },
          { address: { contains: filters.q, mode: 'insensitive' } },
          { contactPerson: { contains: filters.q, mode: 'insensitive' } },
        ],
      });
    }
    if (typeof filters?.isActive === 'boolean') {
      conditions.push({ isActive: filters.isActive });
    }
    if (filters?.paymentTerms) {
      conditions.push({
        paymentTerms:
          filters.paymentTerms as Prisma.SupplierWhereInput['paymentTerms'],
      });
    }
    if (typeof filters?.hasGstin === 'boolean') {
      conditions.push(
        filters.hasGstin ? { NOT: [{ gstin: '' }] } : { OR: [{ gstin: '' }] },
      );
    }
    if (typeof filters?.outstandingMin === 'number') {
      conditions.push({ currentOutstanding: { gte: filters.outstandingMin } });
    }
    if (typeof filters?.outstandingMax === 'number') {
      conditions.push({ currentOutstanding: { lte: filters.outstandingMax } });
    }

    const where: Prisma.SupplierWhereInput =
      conditions.length > 0 ? { AND: conditions } : {};

    const suppliers = await this.prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    const supplierIds = suppliers.map((s) => s.id);
    if (supplierIds.length === 0) {
      return {
        suppliers,
        purchaseOrders: [],
        poItems: [],
        grns: [],
        grnItems: [],
        debitNotes: [],
        debitNoteItems: [],
        payments: [],
        activities: [],
        batches: [],
      };
    }

    // Parallel batched queries, one per child entity. Same pattern as the
    // customers exportData method.
    const [purchaseOrders, grns, debitNotes, payments, activities, batches] =
      await Promise.all([
        this.prisma.purchaseOrder.findMany({
          where: { supplierId: { in: supplierIds } },
          include: { items: true },
          orderBy: { date: 'asc' },
        }),
        this.prisma.gRN.findMany({
          where: { supplierId: { in: supplierIds } },
          include: { items: true },
          orderBy: { date: 'asc' },
        }),
        this.prisma.purchaseReturn.findMany({
          where: { supplierId: { in: supplierIds } },
          include: { items: true },
          orderBy: { date: 'asc' },
        }),
        this.prisma.supplierPayment.findMany({
          where: { supplierId: { in: supplierIds } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.supplierActivity.findMany({
          where: { supplierId: { in: supplierIds } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.batch.findMany({
          where: { supplierId: { in: supplierIds } },
          include: { product: { select: { id: true, name: true } } },
          orderBy: { expiryDate: 'asc' },
        }),
      ]);

    const poItems = purchaseOrders.flatMap((po) =>
      po.items.map((item) => ({ ...item, poNumber: po.poNumber })),
    );
    const grnItems = grns.flatMap((g) =>
      g.items.map((item) => ({ ...item, grnNumber: g.grnNumber })),
    );
    const debitNoteItems = debitNotes.flatMap((d) =>
      d.items.map((item) => ({ ...item, debitNoteNo: d.debitNoteNo })),
    );

    const stripItems = <T extends { items: unknown }>(row: T) => {
      const { items: _items, ...rest } = row;
      void _items;
      return rest;
    };

    return {
      suppliers,
      purchaseOrders: purchaseOrders.map(stripItems),
      poItems,
      grns: grns.map(stripItems),
      grnItems,
      debitNotes: debitNotes.map(stripItems),
      debitNoteItems,
      payments,
      activities,
      batches,
    };
  }

  async update(
    id: string,
    updateSupplierDto: UpdateSupplierDto,
    branchId?: string,
  ) {
    const existing = await this.findOne(id, branchId);
    const data = { ...updateSupplierDto } as UpdateSupplierDto;
    if (data.name !== undefined) {
      this.assertNameNonEmpty(data.name);
      data.name = data.name.trim();
    }
    if (data.phone !== undefined) {
      data.phone = this.normalizePhone(data.phone);
    }
    if (
      data.phone !== undefined ||
      data.gstin !== undefined ||
      data.drugLicense !== undefined
    ) {
      await this.assertNoDuplicate(
        {
          phone: data.phone,
          gstin: data.gstin,
          drugLicense: data.drugLicense,
          branchId: existing.branchId,
        },
        id,
      );
    }
    const updated = await this.prisma.supplier.update({
      where: { id },
      data,
    });
    // Propagate shared identity fields to the linked customer twin (if any).
    try {
      await this.partyLink.syncTwinFields('supplier', id);
    } catch (e) {
      this.logger.warn(`Party-link sync failed for supplier ${id}: ${String(e)}`);
    }
    return updated;
  }

  async remove(id: string, branchId?: string) {
    const supplier = await this.findOne(id, branchId);
    // Block hard-delete if the supplier has any record that depends on them.
    // PurchaseOrders, GRNs, PurchaseReturns, and Batches all carry historical
    // financial / inventory provenance — losing them would break audit trails
    // and may FK-error opaquely at the DB layer.
    const [poCount, grnCount, prCount, batchCount] = await Promise.all([
      this.prisma.purchaseOrder.count({ where: { supplierId: id } }),
      this.prisma.gRN.count({ where: { supplierId: id } }),
      this.prisma.purchaseReturn.count({ where: { supplierId: id } }),
      this.prisma.batch.count({ where: { supplierId: id } }),
    ]);
    const blockers: string[] = [];
    if (poCount) blockers.push(`${poCount} purchase order(s)`);
    if (grnCount) blockers.push(`${grnCount} GRN(s)`);
    if (prCount) blockers.push(`${prCount} purchase return(s)`);
    if (batchCount) blockers.push(`${batchCount} batch(es)`);
    if (blockers.length > 0) {
      throw new BadRequestException(
        `Cannot delete "${supplier.name}" — they're referenced by ${blockers.join(', ')}. Set the supplier inactive instead.`,
      );
    }
    const outstanding = Number((supplier as any).currentOutstanding ?? 0);
    if (outstanding !== 0) {
      throw new BadRequestException(
        `Cannot delete "${supplier.name}" — outstanding balance is ₹${outstanding.toFixed(2)}. Reconcile the ledger first.`,
      );
    }
    return this.prisma.supplier.delete({ where: { id } });
  }
}
