import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBranchDto) {
    const existing = await this.prisma.branch.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException('Branch code already exists');
    return this.prisma.branch.create({ data: dto });
  }

  findAll() {
    return this.prisma.branch.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async update(id: string, dto: UpdateBranchDto) {
    await this.findOne(id);
    // If setting as default, unset others
    if (dto.isDefault) {
      await this.prisma.branch.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    return this.prisma.branch.update({ where: { id }, data: dto });
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
