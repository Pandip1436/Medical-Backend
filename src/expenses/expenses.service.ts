import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

// Canonicalise paymentMode strings to UPPERCASE before storing. Reports filter
// by exact match (`paymentMode IN ('CASH', ...)`), so a row stored as 'Cash'
// silently disappears from the cash book. Normalising on the way in (and on
// updates) keeps the storage shape predictable for everyone.
function normalizePaymentMode(mode: string | null | undefined): string | undefined {
  if (!mode) return undefined;
  return mode.trim().toUpperCase();
}

@Injectable()
export class ExpensesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateExpenseDto, branchId?: string) {
    return this.prisma.expense.create({
      data: {
        date: new Date(dto.date),
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        paymentMode: normalizePaymentMode(dto.paymentMode) ?? 'CASH',
        receiptImage: dto.receiptImage,
        branchId: branchId ?? dto.branchId,
      },
    });
  }

  async findAll(category?: string, from?: string, to?: string, branchId?: string) {
    const where: any = {};
    if (category) where.category = category;
    if (branchId) where.branchId = branchId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    const rows = await this.prisma.expense.findMany({
      where,
      orderBy: { date: 'desc' },
      take: 200,
    });
    return rows.map((e) => ({ ...e, amount: Number(e.amount) }));
  }

  async findOne(id: string, branchId?: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Expense not found');
    if (branchId && expense.branchId && expense.branchId !== branchId) {
      throw new NotFoundException('Expense not found');
    }
    return { ...expense, amount: Number(expense.amount) };
  }

  async update(id: string, dto: UpdateExpenseDto, branchId?: string) {
    await this.findOne(id, branchId);
    const updated = await this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.date && { date: new Date(dto.date) }),
        ...(dto.category && { category: dto.category }),
        ...(dto.description && { description: dto.description }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.paymentMode && { paymentMode: normalizePaymentMode(dto.paymentMode) }),
        ...(dto.receiptImage !== undefined && { receiptImage: dto.receiptImage }),
      },
    });
    return { ...updated, amount: Number(updated.amount) };
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.expense.delete({ where: { id } });
  }
}
