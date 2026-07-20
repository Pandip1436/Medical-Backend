import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

type BranchRow = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  drugLicense: string | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt: Date;
  invoiceCount?: number;
  invoiceTotal?: number;
  expenseTotal?: number;
};

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  // Reject a GSTIN / drug-licence already used by another branch. Branches are
  // global master data (not branch-scoped), so the match is across all rows.
  private async assertUniqueGstinDl(
    data: { gstin?: string | null; drugLicense?: string | null },
    excludeId?: string,
  ) {
    const notSelf = excludeId ? [{ id: { not: excludeId } }] : [];

    const gstin = data.gstin?.trim();
    if (gstin) {
      const dup = await this.prisma.branch.findFirst({
        where: { AND: [{ gstin }, ...notSelf] },
        select: { name: true },
      });
      if (dup) {
        throw new ConflictException(
          `Another branch (${dup.name}) already uses GSTIN ${gstin}.`,
        );
      }
    }

    const dl = data.drugLicense?.trim();
    if (dl) {
      const dup = await this.prisma.branch.findFirst({
        where: {
          AND: [{ drugLicense: { equals: dl, mode: 'insensitive' } }, ...notSelf],
        },
        select: { name: true },
      });
      if (dup) {
        throw new ConflictException(
          `Another branch (${dup.name}) already uses Drug License ${dl}.`,
        );
      }
    }
  }

  // Live availability check for the branch form — flags a taken GSTIN / drug
  // licence as the user types instead of only on submit.
  async checkDuplicate(opts: {
    gstin?: string;
    drugLicense?: string;
    excludeId?: string;
  }) {
    const notSelf = opts.excludeId ? [{ id: { not: opts.excludeId } }] : [];
    const result: {
      gstin?: { taken: boolean; name: string };
      drugLicense?: { taken: boolean; name: string };
    } = {};

    const gstin = opts.gstin?.trim();
    if (gstin) {
      const dup = await this.prisma.branch.findFirst({
        where: { AND: [{ gstin }, ...notSelf] },
        select: { name: true },
      });
      if (dup) result.gstin = { taken: true, name: dup.name };
    }

    const dl = opts.drugLicense?.trim();
    if (dl) {
      const dup = await this.prisma.branch.findFirst({
        where: {
          AND: [{ drugLicense: { equals: dl, mode: 'insensitive' } }, ...notSelf],
        },
        select: { name: true },
      });
      if (dup) result.drugLicense = { taken: true, name: dup.name };
    }

    return result;
  }

  async create(dto: CreateBranchDto) {
    const existing = await this.prisma.branch.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Branch code already exists');
    await this.assertUniqueGstinDl({ gstin: dto.gstin, drugLicense: dto.drugLicense });
    return this.prisma.branch.create({ data: { ...dto, name: dto.name.trim() } });
  }

  // findAll mirrors the suppliers pattern:
  //   • no skip/take provided  → plain Branch[]  (used by the header switcher & branchStore)
  //   • skip/take provided     → { data, total, hasMore } with stats embedded on each row
  //
  // Embedding stats kills the per-card N+1 the BranchesPage used to do, at the cost of one
  // groupBy aggregation per request. Only embedded when canSeeStats=true (matches the
  // existing /branches/:id/stats role-gating: ADMIN / ACCOUNTANT).
  async findAll(opts: {
    q?: string;
    isActive?: boolean;
    hasSales?: boolean;
    skip?: number;
    take?: number;
    canSeeStats?: boolean;
  } = {}) {
    const { q, isActive, hasSales, skip, take, canSeeStats } = opts;

    const conditions: Prisma.BranchWhereInput[] = [];

    if (q) {
      conditions.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { gstin: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
        ],
      });
    }

    if (typeof isActive === 'boolean') {
      conditions.push({ isActive });
    }

    const where: Prisma.BranchWhereInput =
      conditions.length > 0 ? { AND: conditions } : {};

    const paginated = typeof skip === 'number' && typeof take === 'number';

    // Plain-array path — keeps the header switcher fast & backward-compatible.
    if (!paginated) {
      return this.prisma.branch.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
    }

    const safeTake = Math.min(Math.max(take!, 1), 100);
    const safeSkip = Math.max(skip!, 0);

    // hasSales requires the embedded stats to filter on — fetch a wider window and
    // post-filter, since totalSales lives in the aggregated map, not on the Branch row.
    const wantsHasSalesFilter = canSeeStats && typeof hasSales === 'boolean';
    const fetchTake = wantsHasSalesFilter ? Math.max(safeTake * 3, 30) : safeTake;
    const fetchSkip = wantsHasSalesFilter ? 0 : safeSkip;

    const [rows, totalUnfiltered] = await Promise.all([
      this.prisma.branch.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        skip: fetchSkip,
        take: fetchTake,
      }),
      this.prisma.branch.count({ where }),
    ]);

    let enriched: BranchRow[] = rows;

    if (canSeeStats && rows.length > 0) {
      const ids = rows.map((b) => b.id);
      const [invAgg, expAgg] = await Promise.all([
        this.prisma.invoice.groupBy({
          by: ['branchId'],
          where: {
            branchId: { in: ids },
            type: 'INVOICE',
            status: { not: 'CANCELLED' },
          },
          _sum: { grandTotal: true },
          _count: { _all: true },
        }),
        this.prisma.expense.groupBy({
          by: ['branchId'],
          where: { branchId: { in: ids } },
          _sum: { amount: true },
        }),
      ]);

      const invMap = new Map(
        invAgg.map((r) => [
          r.branchId,
          {
            invoiceCount: r._count._all,
            invoiceTotal: Number(r._sum.grandTotal ?? 0),
          },
        ]),
      );
      const expMap = new Map(
        expAgg.map((r) => [r.branchId, Number(r._sum.amount ?? 0)]),
      );

      enriched = rows.map((b) => ({
        ...b,
        invoiceCount: invMap.get(b.id)?.invoiceCount ?? 0,
        invoiceTotal: invMap.get(b.id)?.invoiceTotal ?? 0,
        expenseTotal: expMap.get(b.id) ?? 0,
      }));
    }

    // Post-filter on the enriched rows for hasSales.
    let data = enriched;
    let total = totalUnfiltered;
    if (wantsHasSalesFilter) {
      const filtered = enriched.filter((b) =>
        hasSales ? (b.invoiceTotal ?? 0) > 0 : (b.invoiceTotal ?? 0) === 0,
      );
      total = filtered.length;
      data = filtered.slice(safeSkip, safeSkip + safeTake);
    }

    return {
      data,
      total,
      hasMore: safeSkip + data.length < total,
    };
  }

  // Global summary across all branches — keeps the page's top stat cards
  // stable as the user types/filters in the list below.
  async summary() {
    const [total, active, inactive, invAgg, expAgg] = await Promise.all([
      this.prisma.branch.count(),
      this.prisma.branch.count({ where: { isActive: true } }),
      this.prisma.branch.count({ where: { isActive: false } }),
      this.prisma.invoice.aggregate({
        where: { type: 'INVOICE', status: { not: 'CANCELLED' } },
        _sum: { grandTotal: true },
      }),
      this.prisma.expense.aggregate({ _sum: { amount: true } }),
    ]);
    return {
      total,
      active,
      inactive,
      totalSales: Number(invAgg._sum.grandTotal ?? 0),
      totalExpenses: Number(expAgg._sum.amount ?? 0),
    };
  }

  async findOne(id: string) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async update(id: string, dto: UpdateBranchDto) {
    await this.findOne(id);
    if (dto.gstin !== undefined || dto.drugLicense !== undefined) {
      await this.assertUniqueGstinDl(
        { gstin: dto.gstin, drugLicense: dto.drugLicense },
        id,
      );
    }
    if (dto.isDefault) {
      await this.prisma.branch.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    const data = dto.name !== undefined ? { ...dto, name: dto.name.trim() } : dto;
    return this.prisma.branch.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.branch.delete({ where: { id } });
  }

  async stats(id: string) {
    const [invoiceCount, invoiceTotal, expenseTotal] = await Promise.all([
      this.prisma.invoice.count({ where: { branchId: id, type: 'INVOICE' } }),
      this.prisma.invoice.aggregate({
        where: { branchId: id, type: 'INVOICE', status: { not: 'CANCELLED' } },
        _sum: { grandTotal: true },
      }),
      this.prisma.expense.aggregate({
        where: { branchId: id },
        _sum: { amount: true },
      }),
    ]);
    return {
      invoiceCount,
      invoiceTotal: Number(invoiceTotal._sum.grandTotal ?? 0),
      expenseTotal: Number(expenseTotal._sum.amount ?? 0),
    };
  }
}
