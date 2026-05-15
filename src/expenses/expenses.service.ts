import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { R2UploadService } from '../common/services/r2-upload.service';
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

// Strip the filename to alphanumerics, dots, dashes — keeps the URL readable
// without exposing the raw client filename.
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    private prisma: PrismaService,
    private r2: R2UploadService,
  ) {}

  // Uploads the receipt buffer to R2 under `expense-receipts/<uuid>-<name>`.
  // Returns the public URL. Throws BadRequestException on failure — caller is
  // expected to surface this to the user (no silent loss of the receipt).
  private async uploadReceipt(file: Express.Multer.File): Promise<string> {
    const key = `expense-receipts/${randomUUID()}-${sanitizeFilename(file.originalname)}`;
    try {
      return await this.r2.upload({
        buffer: file.buffer,
        key,
        contentType: file.mimetype,
      });
    } catch (err) {
      this.logger.error(`Receipt upload to R2 failed: ${(err as Error).message}`);
      throw new BadRequestException('Failed to upload receipt — please try again');
    }
  }

  // Best-effort delete; orphaned R2 objects can be GC'd separately and a
  // network blip here shouldn't fail the user's update.
  private async deleteReceiptByUrl(url: string | null | undefined): Promise<void> {
    if (!url) return;
    const key = this.r2.keyFromUrl(url);
    if (!key) return;
    try {
      await this.r2.delete(key);
    } catch (err) {
      this.logger.warn(`Failed to delete old receipt ${key}: ${(err as Error).message}`);
    }
  }

  async create(dto: CreateExpenseDto, branchId?: string, file?: Express.Multer.File) {
    let receiptUrl: string | undefined = dto.receiptImage;
    if (file) {
      receiptUrl = await this.uploadReceipt(file);
    }
    return this.prisma.expense.create({
      data: {
        date: new Date(dto.date),
        category: dto.category,
        description: dto.description,
        amount: dto.amount,
        paymentMode: normalizePaymentMode(dto.paymentMode) ?? 'CASH',
        receiptImage: receiptUrl,
        branchId: branchId ?? dto.branchId,
      },
    });
  }

  async findAll(opts: {
    category?: string;
    from?: string;
    to?: string;
    branchId?: string;
    search?: string;
    paymentMode?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: any = {};
    if (opts.category && opts.category !== 'all') where.category = opts.category;
    if (opts.branchId) where.branchId = opts.branchId;
    if (opts.paymentMode && opts.paymentMode !== 'all') {
      where.paymentMode = { equals: opts.paymentMode.toUpperCase(), mode: 'insensitive' };
    }
    if (opts.from || opts.to) {
      where.date = {};
      if (opts.from) where.date.gte = new Date(opts.from);
      if (opts.to) where.date.lte = new Date(opts.to);
    }
    const search = opts.search?.trim();
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ];
    }

    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 15));
    const skip = (page - 1) * pageSize;

    // Paginated rows + total + an aggregate window for stat cards / chart.
    // All four queries are scoped to the same `where`, so the cards reflect
    // the user's current filter.
    const [rows, total, allMatching] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.findMany({
        where,
        select: { date: true, category: true, amount: true },
      }),
    ]);

    const data = rows.map((e) => ({ ...e, amount: Number(e.amount) }));

    // Monthly summary derived from full matching set (not just current page),
    // so the stat cards represent the whole filter window.
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const lastMonthDate = new Date(thisYear, thisMonth - 1, 1);
    const lastMonth = lastMonthDate.getMonth();
    const lastMonthYear = lastMonthDate.getFullYear();

    let thisMonthTotal = 0;
    let lastMonthTotal = 0;
    let sumAll = 0;
    const breakdownMap = new Map<string, number>();
    for (const r of allMatching) {
      const amt = Number(r.amount);
      sumAll += amt;
      const d = new Date(r.date);
      if (d.getMonth() === thisMonth && d.getFullYear() === thisYear) thisMonthTotal += amt;
      else if (d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear) lastMonthTotal += amt;
      breakdownMap.set(r.category, (breakdownMap.get(r.category) ?? 0) + amt);
    }
    const average = allMatching.length > 0 ? sumAll / allMatching.length : 0;

    const categoryBreakdown = Array.from(breakdownMap.entries())
      .map(([category, totalAmt]) => ({ category, total: totalAmt }))
      .sort((a, b) => b.total - a.total);

    return {
      data,
      total,
      page,
      pageSize,
      monthlySummary: {
        thisMonthTotal,
        lastMonthTotal,
        difference: thisMonthTotal - lastMonthTotal,
        average,
      },
      categoryBreakdown,
    };
  }

  async findOne(id: string, branchId?: string) {
    const expense = await this.prisma.expense.findUnique({ where: { id } });
    if (!expense) throw new NotFoundException('Expense not found');
    if (branchId && expense.branchId && expense.branchId !== branchId) {
      throw new NotFoundException('Expense not found');
    }
    return { ...expense, amount: Number(expense.amount) };
  }

  async update(
    id: string,
    dto: UpdateExpenseDto,
    branchId?: string,
    file?: Express.Multer.File,
  ) {
    const existing = await this.findOne(id, branchId);

    // Receipt change semantics:
    //   - file provided  → upload new, drop old (best-effort)
    //   - dto.receiptImage === ''     → caller explicitly removed receipt; clear field, drop old
    //   - dto.receiptImage === undefined and no file → leave unchanged
    let nextReceipt: string | null | undefined;
    if (file) {
      nextReceipt = await this.uploadReceipt(file);
      await this.deleteReceiptByUrl(existing.receiptImage);
    } else if (dto.receiptImage === '') {
      nextReceipt = null;
      await this.deleteReceiptByUrl(existing.receiptImage);
    } else if (dto.receiptImage !== undefined) {
      nextReceipt = dto.receiptImage;
    }

    const updated = await this.prisma.expense.update({
      where: { id },
      data: {
        ...(dto.date && { date: new Date(dto.date) }),
        ...(dto.category && { category: dto.category }),
        ...(dto.description && { description: dto.description }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.paymentMode && { paymentMode: normalizePaymentMode(dto.paymentMode) }),
        ...(nextReceipt !== undefined && { receiptImage: nextReceipt }),
      },
    });
    return { ...updated, amount: Number(updated.amount) };
  }

  async remove(id: string, branchId?: string) {
    const existing = await this.findOne(id, branchId);
    await this.deleteReceiptByUrl(existing.receiptImage);
    return this.prisma.expense.delete({ where: { id } });
  }
}
