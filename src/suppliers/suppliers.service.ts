import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  // Reject suppliers that duplicate an existing one within the same branch
  // scope on phone or GSTIN. Branch-null (global) suppliers compete for the
  // same uniqueness namespace as everyone in that branch.
  private async assertNoDuplicate(
    data: { phone?: string; gstin?: string; branchId?: string | null },
    excludeId?: string,
  ) {
    const conditions: Prisma.SupplierWhereInput[] = [];
    if (data.phone) conditions.push({ phone: data.phone });
    if (data.gstin) conditions.push({ gstin: data.gstin });
    if (conditions.length === 0) return;

    const branchScope = data.branchId
      ? [{ branchId: data.branchId }, { branchId: null }]
      : [{ branchId: null }];

    const existing = await this.prisma.supplier.findFirst({
      where: {
        AND: [
          { OR: conditions },
          { OR: branchScope },
          ...(excludeId ? [{ id: { not: excludeId } }] : []),
        ],
      },
      select: { id: true, name: true, phone: true, gstin: true },
    });
    if (existing) {
      const field = existing.phone === data.phone ? 'phone' : 'GSTIN';
      throw new ConflictException(
        `Another supplier (${existing.name}) already uses this ${field} in this branch`,
      );
    }
  }

  async create(createSupplierDto: CreateSupplierDto & { branchId?: string }) {
    await this.assertNoDuplicate({
      phone: createSupplierDto.phone,
      gstin: createSupplierDto.gstin,
      branchId: createSupplierDto.branchId ?? null,
    });
    return this.prisma.supplier.create({ data: createSupplierDto });
  }

  findAll(query?: string, branchId?: string) {
    const conditions: Prisma.SupplierWhereInput[] = [];

    // Branch filter: include specific branch + global (null) items
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
    if (updateSupplierDto.phone || updateSupplierDto.gstin) {
      await this.assertNoDuplicate(
        {
          phone: updateSupplierDto.phone,
          gstin: updateSupplierDto.gstin,
          branchId: existing.branchId,
        },
        id,
      );
    }
    return this.prisma.supplier.update({
      where: { id },
      data: updateSupplierDto,
    });
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.supplier.delete({ where: { id } });
  }
}
