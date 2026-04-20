import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  create(createSupplierDto: CreateSupplierDto & { branchId?: string }) {
    return this.prisma.supplier.create({ data: createSupplierDto });
  }

  findAll(query?: string, branchId?: string) {
    const where: any = { AND: [] };

    // Branch filter: include specific branch + global (null) items
    if (branchId && branchId !== 'all') {
      where.AND.push({
        OR: [{ branchId }, { branchId: null }],
      });
    }

    if (query) {
      where.AND.push({
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { gstin: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } },
        ],
      });
    }

    // Clean up empty AND if no filters applied for cleaner Prisma query
    if (where.AND.length === 0) delete where.AND;

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

  async update(id: string, updateSupplierDto: UpdateSupplierDto, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.supplier.update({ where: { id }, data: updateSupplierDto });
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.supplier.delete({ where: { id } });
  }
}
