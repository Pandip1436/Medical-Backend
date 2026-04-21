import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';

@Injectable()
export class QuotationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateQuotationDto) {
    const count = await this.prisma.quotation.count();
    const seq = count + 1;
    const quotationNumber = `HS/25-26/QTN/${String(seq).padStart(5, '0')}`;

    return this.prisma.quotation.create({
      data: {
        quotationNumber,
        customerId: dto.customerId || null,
        customerName: dto.customerName,
        subtotal: dto.subtotal,
        cgst: dto.cgst,
        sgst: dto.sgst,
        total: dto.total,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
        notes: dto.notes,
        status: 'DRAFT',
        items: {
          create: dto.items.map(item => ({
            productId: item.productId || null,
            productName: item.productName,
            batchId: item.batchId || null,
            batchNumber: item.batchNumber || null,
            quantity: item.quantity,
            mrp: item.mrp || 0,
            rate: item.rate,
            discountPercent: item.discountPercent || 0,
            gstPercent: item.gstPercent || 0,
            amount: item.amount,
          })),
        },
      },
      include: { items: true },
    });
  }

  async findAll(filters: {
    q?: string;
    fromDate?: string;
    toDate?: string;
    status?: string;
    amountMin?: number;
    amountMax?: number;
  }) {
    const where: any = {};

    if (filters.q) {
      where.OR = [
        { quotationNumber: { contains: filters.q, mode: 'insensitive' } },
        { customerName: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    if (filters.fromDate || filters.toDate) {
      where.date = {};
      if (filters.fromDate) where.date.gte = new Date(filters.fromDate);
      if (filters.toDate) {
        const toDate = new Date(filters.toDate);
        toDate.setHours(23, 59, 59, 999);
        where.date.lte = toDate;
      }
    }

    if (filters.status) where.status = filters.status;

    if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
      where.total = {};
      if (filters.amountMin !== undefined) where.total.gte = filters.amountMin;
      if (filters.amountMax !== undefined) where.total.lte = filters.amountMax;
    }

    return this.prisma.quotation.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { items: true },
    });
  }

  async findOne(id: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: { items: true, customer: true },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    return quotation;
  }

  async update(id: string, data: any) {
    const existing = await this.prisma.quotation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Quotation not found');
    return this.prisma.quotation.update({
      where: { id },
      data,
      include: { items: true },
    });
  }

  async updateStatus(id: string, status: string) {
    const quotation = await this.prisma.quotation.findUnique({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');

    const validTransitions: Record<string, string[]> = {
      DRAFT: ['SENT', 'ACCEPTED', 'REJECTED'],
      SENT: ['ACCEPTED', 'REJECTED'],
      ACCEPTED: ['CONVERTED'],
      REJECTED: ['DRAFT'],
      CONVERTED: [],
    };

    const allowed = validTransitions[quotation.status] || [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(`Cannot transition from ${quotation.status} to ${status}`);
    }

    return this.prisma.quotation.update({
      where: { id },
      data: { status: status as any },
      include: { items: true },
    });
  }

  async remove(id: string) {
    const quotation = await this.prisma.quotation.findUnique({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status === 'CONVERTED') {
      throw new BadRequestException('Cannot delete a converted quotation');
    }
    return this.prisma.quotation.delete({ where: { id } });
  }

  async getStats() {
    const [all, accepted, pending, rejected] = await Promise.all([
      this.prisma.quotation.aggregate({ _sum: { total: true }, _count: { _all: true } }),
      this.prisma.quotation.aggregate({
        where: { status: { in: ['ACCEPTED', 'CONVERTED'] } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.quotation.aggregate({
        where: { status: { in: ['DRAFT', 'SENT'] } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.quotation.count({ where: { status: 'REJECTED' } }),
    ]);

    return {
      total: Number(all._sum?.total || 0),
      totalCount: all._count._all,
      acceptedTotal: Number(accepted._sum?.total || 0),
      acceptedCount: accepted._count._all,
      pendingTotal: Number(pending._sum?.total || 0),
      pendingCount: pending._count._all,
      rejectedCount: rejected,
    };
  }
}
