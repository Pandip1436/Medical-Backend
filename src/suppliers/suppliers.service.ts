import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  create(createSupplierDto: CreateSupplierDto) {
    return this.prisma.supplier.create({
      data: createSupplierDto,
    });
  }

  findAll(query?: string) {
    if (query) {
      return this.prisma.supplier.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { gstin: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query } },
          ],
        },
      });
    }
    return this.prisma.supplier.findMany();
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        batches: true,
        purchaseOrders: {
          take: 10,
          orderBy: { date: 'desc' },
        },
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async update(id: string, updateSupplierDto: UpdateSupplierDto) {
    await this.findOne(id);
    return this.prisma.supplier.update({
      where: { id },
      data: updateSupplierDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.supplier.delete({
      where: { id },
    });
  }
}
