import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { syncPaymentDueForInvoice } from '../notifications/payment-due-sync';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  // Strip everything except digits so "9876543210", "(987) 654-3210", and
  // "+91 98765 43210" all collapse to a comparable form. Used both for the
  // uniqueness check and for what gets persisted, so the stored value stays
  // canonical.
  private normalizePhone(phone: string | null | undefined): string {
    if (!phone) return '';
    return phone.replace(/\D/g, '');
  }

  // Reject creating a customer that duplicates an existing one's phone within
  // the same branch scope. Phone is the natural key pharmacies use to look
  // people up — duplicates split a customer's history across two records.
  private async assertUniquePhone(
    phone: string,
    branchId?: string | null,
    excludeId?: string,
  ) {
    const normalized = this.normalizePhone(phone);
    if (!normalized) return;
    const branchScope = branchId
      ? [{ branchId }, { branchId: null }]
      : [{ branchId: null }];
    // Match any existing record whose digits-only phone matches. We can't do
    // this in pure SQL without a normalised column, so we scan candidates
    // matching the last 10 digits (Indian mobile length) — narrow enough to
    // keep this cheap on real data.
    const last10 = normalized.slice(-10);
    const candidates = await this.prisma.customer.findFirst({
      where: {
        AND: [
          { phone: { contains: last10 } },
          { OR: branchScope },
          ...(excludeId ? [{ id: { not: excludeId } }] : []),
        ],
      },
      select: { id: true, name: true, phone: true },
    });
    if (candidates && this.normalizePhone(candidates.phone) === normalized) {
      throw new ConflictException(
        `Phone ${phone} is already used by customer "${candidates.name}". Search and edit that record instead of creating a duplicate.`,
      );
    }
  }

  async create(
    createCustomerDto: CreateCustomerDto & { branchId?: string },
    user?: { userId: string; role: string },
  ) {
    // Canonicalise phone before storing so future lookups + the unique check
    // both work even if the user pasted in a formatted number. Belt-and-braces
    // trim on `name` too (the DTO already does this — this guards the
    // approval-replay path that calls this method directly with payloads
    // that were stored before the DTO trim landed). Bug #7.
    const normalizedPhone = this.normalizePhone(createCustomerDto.phone);
    const dto = {
      ...createCustomerDto,
      phone: normalizedPhone,
      name: typeof createCustomerDto.name === 'string' ? createCustomerDto.name.trim() : createCustomerDto.name,
    };
    // Block phone-duplicate before either path (direct create or approval).
    // For the approval path we want the pharmacist to see the conflict
    // immediately rather than having admin discover it later.
    await this.assertUniquePhone(
      dto.phone,
      dto.branchId ?? null,
    );

    // PHARMACISTs must request approval; ADMINs and others create directly
    if (user?.role === 'PHARMACIST') {
      const { branchId, ...payload } = dto;
      const req = await this.approvalsService.createRequest({
        type: 'NEW_CUSTOMER',
        payload: payload as Record<string, any>,
        requestedById: user.userId,
        branchId,
      });
      return { approvalRequested: true, approvalRequestId: req.id };
    }
    return this.prisma.customer.create({ data: dto });
  }

  async bulkCreate(customers: CreateCustomerDto[], branchId?: string) {
    let createdCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Pre-fetch existing phones for this branch to validate in memory
    const branchScope = branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }];
    const existingCustomers = await this.prisma.customer.findMany({
      where: { OR: branchScope },
      select: { phone: true }
    });

    const existingPhones = new Set(existingCustomers.map(c => this.normalizePhone(c.phone)).filter(Boolean));
    const toCreate = [];

    for (const [index, c] of customers.entries()) {
      try {
        const normalizedPhone = this.normalizePhone(c.phone);
        
        if (normalizedPhone) {
          const last10 = normalizedPhone.slice(-10);
          const isDup = Array.from(existingPhones).some(p => p.endsWith(last10));
          if (isDup) {
             throw new ConflictException(`Phone ending in ${last10} already exists.`);
          }
        }
        
        if (normalizedPhone) existingPhones.add(normalizedPhone);
        
        toCreate.push({
          ...c,
          phone: normalizedPhone,
          branchId: branchId ?? null,
        });
      } catch (err: any) {
        skippedCount++;
        errors.push(`Row ${index + 1} (${c.name}): ${err.message}`);
      }
    }

    if (toCreate.length > 0) {
      await this.prisma.customer.createMany({
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
      customerType?: 'RETAIL' | 'WHOLESALE' | 'DOCTOR';
      hasOutstanding?: boolean;
      hasGstin?: boolean;
    },
  ) {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (query) {
      // Match against name (case-insensitive), phone digits, GSTIN, or address.
      // Typing a GSTIN or a locality/street into the search box should surface
      // the right customer.
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { phone: { contains: query } },
        { gstin: { contains: query, mode: 'insensitive' } },
        { address: { contains: query, mode: 'insensitive' } },
      ];
    }

    if (filters?.customerType) {
      where.type = filters.customerType;
    }
    if (typeof filters?.hasOutstanding === 'boolean') {
      where.currentOutstanding = filters.hasOutstanding
        ? { gt: 0 }
        : { lte: 0 };
    }
    if (typeof filters?.hasGstin === 'boolean') {
      // Empty-string GSTIN is treated the same as null (legacy rows persist
      // both). Use NOT/OR to capture either case correctly.
      where.AND = [
        ...(where.AND ?? []),
        filters.hasGstin
          ? { NOT: [{ gstin: '' }, { gstin: null as any }] }
          : { OR: [{ gstin: '' }, { gstin: null as any }] },
      ];
    }

    const paginated = typeof skip === 'number' && typeof take === 'number';
    // Clamp take to a sane max so a rogue caller can't request the universe.
    const safeTake = paginated ? Math.min(Math.max(take, 1), 100) : undefined;
    const safeSkip = paginated ? Math.max(skip, 0) : undefined;

    const findArgs: any = {
      where,
      orderBy: { name: 'asc' as const },
      include: {
        _count: {
          select: {
            invoices: { where: { status: { in: ['UNPAID', 'PARTIAL'] } } },
          },
        },
      },
    };
    if (paginated) {
      findArgs.skip = safeSkip;
      findArgs.take = safeTake;
    }

    const [customers, total] = paginated
      ? await Promise.all([
          this.prisma.customer.findMany(findArgs),
          this.prisma.customer.count({ where }),
        ])
      : [await this.prisma.customer.findMany(findArgs), undefined];

    const flattened = (customers as Array<any>).map(({ _count, ...c }) => ({
      ...c,
      pendingCreditCount: _count.invoices,
    }));

    // Legacy callers (no pagination params) keep the plain-array contract.
    if (!paginated) return flattened;

    return {
      data: flattened,
      total: total ?? 0,
      hasMore: (safeSkip ?? 0) + flattened.length < (total ?? 0),
    };
  }

  // Bulk export for the Export → edit → Re-import workflow. Returns the
  // full data tree (customers + every history entity) in one batched-query
  // shot so the client can build a workbook that mirrors the import template.
  //
  // Filters mirror findAll() exactly so the operator's current filter UI
  // narrows the export. Branch-scoped just like the rest of the app.
  async exportData(
    branchId?: string,
    filters?: {
      customerType?: 'RETAIL' | 'WHOLESALE' | 'DOCTOR';
      hasOutstanding?: boolean;
      hasGstin?: boolean;
      q?: string;
    },
  ) {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (filters?.q) {
      where.OR = [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { phone: { contains: filters.q } },
        { gstin: { contains: filters.q, mode: 'insensitive' } },
        { address: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    if (filters?.customerType) where.type = filters.customerType;
    if (typeof filters?.hasOutstanding === 'boolean') {
      where.currentOutstanding = filters.hasOutstanding
        ? { gt: 0 }
        : { lte: 0 };
    }
    if (typeof filters?.hasGstin === 'boolean') {
      where.AND = [
        ...(where.AND ?? []),
        filters.hasGstin
          ? { NOT: [{ gstin: '' }, { gstin: null as any }] }
          : { OR: [{ gstin: '' }, { gstin: null as any }] },
      ];
    }

    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    const customerIds = customers.map((c) => c.id);
    if (customerIds.length === 0) {
      return {
        customers,
        invoices: [],
        invoiceItems: [],
        payments: [],
        activities: [],
        prescriptions: [],
        quotations: [],
        quotationItems: [],
        creditNotes: [],
        creditNoteItems: [],
      };
    }

    // One batched query per child table. Each is independent so we run them
    // in parallel — completes in a single round-trip's worth of latency.
    const [invoices, payments, activities, prescriptions, quotations, creditNotes] =
      await Promise.all([
        this.prisma.invoice.findMany({
          where: { customerId: { in: customerIds } },
          include: { items: true },
          orderBy: { date: 'asc' },
        }),
        this.prisma.payment.findMany({
          where: { customerId: { in: customerIds } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.customerActivity.findMany({
          where: { customerId: { in: customerIds } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.prescription.findMany({
          where: { customerId: { in: customerIds } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.quotation.findMany({
          where: { customerId: { in: customerIds } },
          include: { items: true },
          orderBy: { date: 'asc' },
        }),
        this.prisma.creditNote.findMany({
          where: { customerId: { in: customerIds } },
          include: { items: true },
          orderBy: { date: 'asc' },
        }),
      ]);

    // Flatten item arrays — frontend transformer wants them on a separate
    // sheet linked by invoice/quotation/credit-note ref, not nested.
    const invoiceItems = invoices.flatMap((i) =>
      i.items.map((item) => ({ ...item, invoiceNumber: i.invoiceNumber })),
    );
    const quotationItems = quotations.flatMap((q) =>
      q.items.map((item) => ({ ...item, quotationNumber: q.quotationNumber })),
    );
    const creditNoteItems = creditNotes.flatMap((cn) =>
      cn.items.map((item) => ({ ...item, creditNoteNo: cn.creditNoteNo })),
    );

    const stripItems = <T extends { items: unknown }>(row: T) => {
      const { items: _items, ...rest } = row;
      void _items;
      return rest;
    };

    return {
      customers,
      invoices: invoices.map(stripItems),
      invoiceItems,
      payments,
      activities,
      prescriptions,
      quotations: quotations.map(stripItems),
      quotationItems,
      creditNotes: creditNotes.map(stripItems),
      creditNoteItems,
    };
  }

  // Canonical "outstanding" definition — shared by /customers/summary,
  // /customers/outstanding, and /reports/dashboard. Computed LIVE from
  // invoices (sum of grandTotal - amountPaid over UNPAID|PARTIAL invoices)
  // rather than from the denormalized customer.currentOutstanding column,
  // which drifts whenever a payment/return/edit path forgets to refresh it.
  // The three KPI tiles previously disagreed (₹1,80,313 vs ₹2,04,043 with
  // a 7-vs-8 customer-count delta) because two of them read the stale
  // cached column and only OutstandingPage computed live. (Phase 3 bugs #1 + #3.)
  //
  // Returns the per-customer rollup so downstream callers can derive either
  // total-by-customer (summary) or row-level aging (getOutstanding) without
  // running the same query twice.
  async computeLiveOutstanding(branchId?: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: ['UNPAID', 'PARTIAL'] },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        customerId: true,
        customerName: true,
        grandTotal: true,
        amountPaid: true,
        date: true,
        branchId: true,
      },
      orderBy: { date: 'asc' },
    });

    const map = new Map<string, {
      customerId: string;
      customerName: string;
      outstanding: number;
      invoices: typeof invoices;
    }>();

    for (const inv of invoices) {
      if (!inv.customerId) continue;
      const due = Number(inv.grandTotal) - Number(inv.amountPaid);
      if (due <= 0) continue;
      const key = inv.customerId;
      if (!map.has(key)) {
        map.set(key, {
          customerId: inv.customerId,
          customerName: inv.customerName,
          outstanding: 0,
          invoices: [],
        });
      }
      const entry = map.get(key)!;
      entry.outstanding += due;
      entry.invoices.push(inv);
    }

    let totalOutstanding = 0;
    for (const entry of map.values()) totalOutstanding += entry.outstanding;
    return {
      totalOutstanding,
      withOutstanding: map.size,
      byCustomer: map,
    };
  }

  // Global summary across all customers (optionally scoped to a branch). Kept
  // unfiltered intentionally — these power top-of-page stat cards that should
  // remain stable as the user types in the search box below.
  async summary(branchId?: string) {
    const where: any = branchId ? { branchId } : {};
    const [total, live] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.computeLiveOutstanding(branchId),
    ]);
    return {
      total,
      withOutstanding: live.withOutstanding,
      totalOutstanding: live.totalOutstanding,
    };
  }

  async findOne(id: string, branchId?: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        prescriptions: true,
        invoices: { take: 10, orderBy: { date: 'desc' } },
        // Count of unsettled (UNPAID/PARTIAL) invoices — the same figure the
        // credit-sale gate uses (see BillingService). Surfaced so the UI can
        // show credit usage as "<pending>/<max>".
        _count: {
          select: {
            invoices: { where: { status: { in: ['UNPAID', 'PARTIAL'] } } },
          },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (branchId && customer.branchId && customer.branchId !== branchId) {
      throw new NotFoundException('Customer not found');
    }
    const { _count, ...rest } = customer as typeof customer & {
      _count: { invoices: number };
    };
    return {
      ...rest,
      pendingCreditCount: _count.invoices,
      maxPendingCredit: Number(process.env.MAX_PENDING_CREDIT ?? 3),
    };
  }

  async update(id: string, updateCustomerDto: UpdateCustomerDto, branchId?: string) {
    const existing = await this.findOne(id, branchId);
    const data = { ...updateCustomerDto } as UpdateCustomerDto;
    if (data.phone !== undefined) {
      const normalized = this.normalizePhone(data.phone);
      if (normalized !== this.normalizePhone(existing.phone)) {
        await this.assertUniquePhone(normalized, existing.branchId ?? null, id);
      }
      data.phone = normalized;
    }
    // Bug #7 belt-and-braces: trim name on edit too, even though the DTO
    // already trims via @Transform — guards admin tools that hit this
    // service with a raw object instead of going through the controller.
    if (typeof data.name === 'string') data.name = data.name.trim();
    return this.prisma.customer.update({ where: { id }, data });
  }

  async remove(id: string, branchId?: string) {
    const customer = await this.findOne(id, branchId);
    // Block delete if the customer has any non-terminal invoices. Hard-deleting
    // a customer with open credit invoices would either FK-cascade their entire
    // history away or fail with an opaque DB error — both bad outcomes.
    const openInvoiceCount = await this.prisma.invoice.count({
      where: {
        customerId: id,
        status: { notIn: ['PAID', 'RETURNED', 'CANCELLED'] },
      },
    });
    if (openInvoiceCount > 0) {
      throw new BadRequestException(
        `Cannot delete "${customer.name}" — they have ${openInvoiceCount} open invoice(s). Settle or cancel those first, or set the customer inactive instead.`,
      );
    }
    const outstanding = Number(customer.currentOutstanding ?? 0);
    if (outstanding > 0) {
      throw new BadRequestException(
        `Cannot delete "${customer.name}" — outstanding balance is ₹${outstanding.toFixed(2)}. Reconcile the ledger first.`,
      );
    }
    return this.prisma.customer.delete({ where: { id } });
  }

  async getOutstanding(
    branchId?: string,
    filters?: {
      q?: string;
      bucket?: 'current' | '0-30' | '31-60' | '61-90' | '90+';
      minOutstanding?: number;
    },
  ) {
    // Share the canonical live query with summary() / dashboard so the three
    // KPI tiles can never disagree. See computeLiveOutstanding() for the rule.
    const { byCustomer: map } = await this.computeLiveOutstanding(branchId);

    // Batch-fetch phones for every customer in the aggregate result so the
    // Outstanding page can render "name + phone" per row. One query keyed on
    // customerId is cheaper than including customer on every aggregated
    // invoice in computeLiveOutstanding (which would re-fetch the same phone
    // N times per customer).
    const customerIds = Array.from(map.keys());
    const phoneMap = new Map<string, string>();
    if (customerIds.length) {
      const customers = await this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, phone: true },
      });
      for (const c of customers) phoneMap.set(c.id, c.phone);
    }

    const now = Date.now();
    let rows = Array.from(map.values()).map((entry) => {
      let current = 0, d0_30 = 0, d31_60 = 0, d61_90 = 0, d90plus = 0;
      for (const inv of entry.invoices) {
        const due = Number(inv.grandTotal) - Number(inv.amountPaid);
        const ageDays = Math.floor((now - new Date(inv.date).getTime()) / 86400000);
        if (ageDays <= 0) current += due;
        else if (ageDays <= 30) d0_30 += due;
        else if (ageDays <= 60) d31_60 += due;
        else if (ageDays <= 90) d61_90 += due;
        else d90plus += due;
      }
      return {
        customerId: entry.customerId,
        customer: entry.customerName,
        customerPhone: phoneMap.get(entry.customerId) ?? null,
        outstanding: entry.outstanding,
        current,
        '0-30': d0_30,
        '31-60': d31_60,
        '61-90': d61_90,
        '90+': d90plus,
        invoiceCount: entry.invoices.length,
      };
    });

    // Apply post-aggregation filters (cheap — the row set is small).
    if (filters?.q) {
      const q = filters.q.toLowerCase();
      rows = rows.filter((r) => r.customer.toLowerCase().includes(q));
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

  // Per-customer drill-down for the OutstandingPage drawer: returns each
  // unpaid invoice with its balance + age in days. Sorted oldest-first to
  // match the FIFO allocation order used by recordPayment().
  async getCustomerOutstandingInvoices(customerId: string, branchId?: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        customerId,
        status: { in: ['UNPAID', 'PARTIAL'] },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        date: true,
        grandTotal: true,
        amountPaid: true,
        status: true,
      },
      orderBy: { date: 'asc' },
    });

    const now = Date.now();
    return invoices
      .map((inv) => {
        const grandTotal = Number(inv.grandTotal);
        const amountPaid = Number(inv.amountPaid);
        const balance = grandTotal - amountPaid;
        const daysOverdue = Math.max(
          0,
          Math.floor((now - new Date(inv.date).getTime()) / 86400000),
        );
        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          date: inv.date,
          grandTotal,
          amountPaid,
          balance,
          status: inv.status,
          daysOverdue,
        };
      })
      .filter((inv) => inv.balance > 0);
  }

  // Allocates payment across UNPAID/PARTIAL invoices.
  // - If `invoiceIds` is provided, payment is applied ONLY to those invoices
  //   (oldest-first within the selected set).
  // - Otherwise, FIFO across all open invoices for the customer.
  // Creates a Payment record and updates invoice statuses + customer outstanding.
  async recordPayment(
    id: string,
    amount: number,
    paymentMode: string,
    referenceNumber?: string,
    branchId?: string,
    invoiceIds?: string[],
  ) {
    if (amount <= 0) throw new BadRequestException('Amount must be greater than zero');

    const customer = await this.findOne(id, branchId);

    const useSpecific = Array.isArray(invoiceIds) && invoiceIds.length > 0;

    const openInvoices = await this.prisma.invoice.findMany({
      where: {
        customerId: id,
        status: { in: ['UNPAID', 'PARTIAL'] },
        ...(useSpecific ? { id: { in: invoiceIds } } : {}),
      },
      orderBy: { date: 'asc' },
    });

    if (openInvoices.length === 0) {
      throw new BadRequestException(
        useSpecific
          ? 'Selected invoices are not open or do not belong to this customer'
          : 'No outstanding invoices for this customer',
      );
    }

    if (
      invoiceIds &&
      useSpecific &&
      openInvoices.length !== invoiceIds.length
    ) {
      throw new BadRequestException(
        'One or more selected invoices are not open or do not belong to this customer',
      );
    }

    const totalOutstanding = openInvoices.reduce(
      (s, inv) => s + Number(inv.grandTotal) - Number(inv.amountPaid),
      0,
    );

    if (amount > totalOutstanding + 0.01) {
      throw new BadRequestException(
        useSpecific
          ? `Payment amount (₹${amount.toFixed(2)}) exceeds balance of selected invoices (₹${totalOutstanding.toFixed(2)})`
          : `Payment amount (₹${amount.toFixed(2)}) exceeds outstanding balance (₹${totalOutstanding.toFixed(2)})`,
      );
    }

    const receiptNumber = `RCT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    return this.prisma.$transaction(async (tx) => {
      let remaining = amount;
      const allocations: { invoiceId: string; applied: number; newStatus: string }[] = [];

      for (const inv of openInvoices) {
        if (remaining <= 0.01) break;
        const due = Number(inv.grandTotal) - Number(inv.amountPaid);
        const applied = Math.min(remaining, due);
        const newAmountPaid = Number(inv.amountPaid) + applied;
        const stillDue = Number(inv.grandTotal) - newAmountPaid;
        const newStatus = stillDue <= 0.01 ? 'PAID' : 'PARTIAL';

        await tx.invoice.update({
          where: { id: inv.id },
          data: { amountPaid: newAmountPaid, status: newStatus },
        });

        // Resolve the reminder if this invoice is now cleared, else refresh its amount.
        await syncPaymentDueForInvoice(tx, {
          id: inv.id,
          status: newStatus,
          grandTotal: inv.grandTotal,
          amountPaid: newAmountPaid,
          date: inv.date,
          customerName: inv.customerName,
          invoiceNumber: inv.invoiceNumber,
          customerId: inv.customerId,
        });

        allocations.push({ invoiceId: inv.id, applied, newStatus });
        remaining -= applied;
      }

      // Decrement customer outstanding by actual amount applied
      const totalApplied = amount - Math.max(0, remaining);
      await tx.customer.update({
        where: { id },
        data: { currentOutstanding: { decrement: totalApplied } },
      });

      // Create a single Payment record for the full collection
      const payment = await tx.payment.create({
        data: {
          receiptNumber,
          customerId: id,
          // link to first invoice if only one touched, else null (lump payment)
          invoiceId: allocations.length === 1 ? allocations[0].invoiceId : null,
          amount: totalApplied,
          paymentMode,
          referenceNumber: referenceNumber ?? null,
          branchId: customer.branchId ?? branchId ?? null,
        },
      });

      return {
        receiptNumber: payment.receiptNumber,
        customerId: id,
        amountRecorded: totalApplied,
        allocations,
        newOutstanding: Math.max(0, Number(customer.currentOutstanding) - totalApplied),
      };
    });
  }

  async getPaymentHistory(
    id: string,
    branchId?: string,
    opts?: { from?: string; to?: string; skip?: number; take?: number },
  ) {
    await this.findOne(id, branchId);
    const where: any = { customerId: id };
    if (opts?.from || opts?.to) {
      where.createdAt = {};
      if (opts.from) where.createdAt.gte = new Date(opts.from);
      if (opts.to) {
        const toEnd = new Date(opts.to);
        toEnd.setHours(23, 59, 59, 999);
        where.createdAt.lte = toEnd;
      }
    }

    const paginated = typeof opts?.skip === 'number' && typeof opts?.take === 'number';
    if (!paginated) {
      return this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    }

    const safeTake = Math.min(Math.max(opts!.take!, 1), 100);
    const safeSkip = Math.max(opts!.skip!, 0);
    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: safeSkip,
        take: safeTake,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { data, total, hasMore: safeSkip + data.length < total };
  }
}
