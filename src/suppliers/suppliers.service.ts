import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

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
    data: { phone?: string; gstin?: string; branchId?: string | null },
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

  async create(createSupplierDto: CreateSupplierDto & { branchId?: string }) {
    const dto = {
      ...createSupplierDto,
      phone: this.normalizePhone(createSupplierDto.phone),
    };
    await this.assertNoDuplicate({
      phone: dto.phone,
      gstin: dto.gstin,
      branchId: dto.branchId ?? null,
    });
    return this.prisma.supplier.create({ data: dto });
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
          phone: normalizedPhone,
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
        conditions.push(
          filters.hasGstin
            ? { NOT: [{ gstin: '' }, { gstin: null as any }] }
            : { OR: [{ gstin: '' }, { gstin: null as any }] },
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

    const where: Prisma.SupplierWhereInput =
      conditions.length > 0 ? { AND: conditions } : {};

    const paginated = typeof skip === 'number' && typeof take === 'number';
    const safeTake = paginated ? Math.min(Math.max(take, 1), 100) : undefined;
    const safeSkip = paginated ? Math.max(skip, 0) : undefined;

    if (!paginated) {
      return this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
      });
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
      data,
      total,
      hasMore: (safeSkip ?? 0) + data.length < total,
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
        activities: [],
        batches: [],
      };
    }

    // Parallel batched queries, one per child entity. Same pattern as the
    // customers exportData method.
    const [purchaseOrders, grns, debitNotes, activities, batches] =
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
    if (data.phone !== undefined) {
      data.phone = this.normalizePhone(data.phone);
    }
    if (data.phone !== undefined || data.gstin !== undefined) {
      await this.assertNoDuplicate(
        {
          phone: data.phone,
          gstin: data.gstin,
          branchId: existing.branchId,
        },
        id,
      );
    }
    return this.prisma.supplier.update({
      where: { id },
      data,
    });
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
