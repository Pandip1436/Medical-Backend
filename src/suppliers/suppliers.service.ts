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

  findAll(query?: string, branchId?: string) {
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

    const where: Prisma.SupplierWhereInput =
      conditions.length > 0 ? { AND: conditions } : {};
    return this.prisma.supplier.findMany({ where });
  }

  async findOne(id: string, branchId?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        batches: true,
        purchaseOrders: { take: 10, orderBy: { date: 'desc' } },
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    if (branchId && supplier.branchId && supplier.branchId !== branchId) {
      throw new NotFoundException('Supplier not found');
    }
    return supplier;
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
