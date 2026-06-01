import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  async create(dto: CreateQuotationDto, branchId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const quotationNumber = await this.numbering.nextNumber(
        tx,
        'QTN',
        branchId ?? null,
      );
      return tx.quotation.create({
        data: {
          quotationNumber,
          branchId,
          customerId: dto.customerId || null,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone || null,
          subtotal: dto.subtotal,
          cgst: dto.cgst,
          sgst: dto.sgst,
          deliveryCharge: dto.deliveryCharge ?? 0,
          total: dto.total,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          notes: dto.notes,
          status: 'DRAFT',
          // Link to a CRM Lead when the quote is created via the lead detail
          // "Create Quote" quick action. Field is optional everywhere else.
          ...(dto.leadId && { leadId: dto.leadId }),
          items: {
            create: dto.items.map((item) => ({
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
    });
  }

  async findAll(filters: {
    q?: string;
    fromDate?: string;
    toDate?: string;
    status?: string;
    amountMin?: number;
    amountMax?: number;
    branchId?: string;
    customerId?: string;
    customerPhone?: string;
  }) {
    const where: Prisma.QuotationWhereInput = {};

    if (filters.branchId) where.branchId = filters.branchId;

    // Customer scoping: match by id OR phone. This lets us also surface
    // quotations originally created with a lightweight (no-id) customer
    // once the same phone is later promoted into a real Customer record.
    if (filters.customerId || filters.customerPhone) {
      const customerOr: Prisma.QuotationWhereInput[] = [];
      if (filters.customerId) customerOr.push({ customerId: filters.customerId });
      if (filters.customerPhone) customerOr.push({ customerPhone: filters.customerPhone });
      where.AND = [{ OR: customerOr }];
    }

    if (filters.q) {
      where.OR = [
        { quotationNumber: { contains: filters.q, mode: 'insensitive' } },
        { customerName: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    if (filters.fromDate || filters.toDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (filters.fromDate) dateFilter.gte = new Date(filters.fromDate);
      if (filters.toDate) {
        const toDate = new Date(filters.toDate);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.lte = toDate;
      }
      where.date = dateFilter;
    }

    if (filters.status) where.status = filters.status as Prisma.QuotationWhereInput['status'];

    if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
      const totalFilter: Prisma.DecimalFilter = {};
      if (filters.amountMin !== undefined) totalFilter.gte = filters.amountMin;
      if (filters.amountMax !== undefined) totalFilter.lte = filters.amountMax;
      where.total = totalFilter;
    }

    // Safety cap — same approach as billing.findAll. Quotations can grow
    // unbounded over time (every sales lead generates one), so callers that
    // don't paginate should never get more than 200 rows in a single response.
    // List pages that need full pagination can extend this to accept skip/take.
    return this.prisma.quotation.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { items: true },
      take: 200,
    });
  }

  async findOne(id: string, branchId?: string) {
    const quotation = await this.prisma.quotation.findUnique({
      where: { id },
      include: { items: true, customer: true },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (branchId && quotation.branchId && quotation.branchId !== branchId) {
      throw new NotFoundException('Quotation not found');
    }
    return quotation;
  }

  async update(id: string, data: Prisma.QuotationUpdateInput, branchId?: string) {
    const existing = await this.prisma.quotation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Quotation not found');
    if (branchId && existing.branchId && existing.branchId !== branchId) {
      throw new NotFoundException('Quotation not found');
    }
    return this.prisma.quotation.update({
      where: { id },
      data,
      include: { items: true },
    });
  }

  async updateStatus(id: string, status: string, branchId?: string) {
    const quotation = await this.prisma.quotation.findUnique({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (branchId && quotation.branchId && quotation.branchId !== branchId) {
      throw new NotFoundException('Quotation not found');
    }

    const validTransitions: Record<string, string[]> = {
      DRAFT: ['SENT', 'ACCEPTED', 'REJECTED'],
      SENT: ['ACCEPTED', 'REJECTED'],
      ACCEPTED: ['CONVERTED'],
      REJECTED: ['DRAFT'],
      CONVERTED: [],
    };

    const allowed = validTransitions[quotation.status] || [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition from ${quotation.status} to ${status}`,
      );
    }

    return this.prisma.quotation.update({
      where: { id },
      data: { status: status as Prisma.QuotationUpdateInput['status'] },
      include: { items: true },
    });
  }

  async remove(id: string, branchId?: string) {
    const quotation = await this.prisma.quotation.findUnique({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (branchId && quotation.branchId && quotation.branchId !== branchId) {
      throw new NotFoundException('Quotation not found');
    }
    if (quotation.status === 'CONVERTED') {
      throw new BadRequestException('Cannot delete a converted quotation');
    }
    return this.prisma.quotation.delete({ where: { id } });
  }

  async getStats(branchId?: string) {
    const branchWhere: Prisma.QuotationWhereInput = branchId ? { branchId } : {};
    const [all, accepted, pending, rejected] = await Promise.all([
      this.prisma.quotation.aggregate({
        where: branchWhere,
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.quotation.aggregate({
        where: { ...branchWhere, status: { in: ['ACCEPTED', 'CONVERTED'] } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.quotation.aggregate({
        where: { ...branchWhere, status: { in: ['DRAFT', 'SENT'] } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.quotation.count({
        where: { ...branchWhere, status: 'REJECTED' },
      }),
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
