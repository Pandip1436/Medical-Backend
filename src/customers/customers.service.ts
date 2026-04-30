import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
  ) {}

  async create(
    createCustomerDto: CreateCustomerDto & { branchId?: string },
    user?: { userId: string; role: string },
  ) {
    // PHARMACISTs must request approval; ADMINs and others create directly
    if (user?.role === 'PHARMACIST') {
      const { branchId, ...payload } = createCustomerDto;
      const req = await this.approvalsService.createRequest({
        type: 'NEW_CUSTOMER',
        payload: payload as Record<string, any>,
        requestedById: user.userId,
        branchId,
      });
      return { approvalRequested: true, approvalRequestId: req.id };
    }
    return this.prisma.customer.create({ data: createCustomerDto });
  }

  async findAll(query?: string, branchId?: string) {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (query) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { phone: { contains: query } },
      ];
    }
    const customers = await this.prisma.customer.findMany({
      where,
      include: {
        _count: {
          select: {
            invoices: { where: { status: { in: ['CREDIT', 'PARTIAL'] } } },
          },
        },
      },
    });
    // Flatten _count into a plain pendingCreditCount field
    return customers.map(({ _count, ...c }) => ({
      ...c,
      pendingCreditCount: _count.invoices,
    }));
  }

  async findOne(id: string, branchId?: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        prescriptions: true,
        invoices: { take: 10, orderBy: { date: 'desc' } },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (branchId && customer.branchId && customer.branchId !== branchId) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async update(id: string, updateCustomerDto: UpdateCustomerDto, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.customer.update({ where: { id }, data: updateCustomerDto });
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.customer.delete({ where: { id } });
  }

  async getOutstanding(branchId?: string) {
    // Compute live from CREDIT/PARTIAL invoices — avoids stale currentOutstanding field
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: ['CREDIT', 'PARTIAL'] },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        customerId: true,
        customerName: true,
        grandTotal: true,
        amountPaid: true,
        date: true,
        branchId: true,
      },
      orderBy: { date: 'asc' },
    });

    const map = new Map<string, {
      customerId: string | null;
      customerName: string;
      outstanding: number;
      invoices: typeof invoices;
    }>();

    for (const inv of invoices) {
      if (!inv.customerId) continue;
      const key = inv.customerId;
      const due = Number(inv.grandTotal) - Number(inv.amountPaid);
      if (due <= 0) continue;
      if (!map.has(key)) {
        map.set(key, { customerId: inv.customerId, customerName: inv.customerName, outstanding: 0, invoices: [] });
      }
      const entry = map.get(key)!;
      entry.outstanding += due;
      entry.invoices.push(inv);
    }

    const now = Date.now();
    const rows = Array.from(map.values()).map((entry) => {
      let current = 0, d0_30 = 0, d31_60 = 0, d61_90 = 0, d90plus = 0;
      for (const inv of entry.invoices) {
        const due = Number(inv.grandTotal) - Number(inv.amountPaid);
        const ageDays = Math.floor((now - new Date(inv.date).getTime()) / 86400000);
        if (ageDays <= 0) current += due;
        else if (ageDays <= 30) d0_30 += due;
        else if (ageDays <= 60) d31_60 += due;
        else if (ageDays <= 90) d61_90 += due;
        else d90plus += due;
      }
      return {
        customerId: entry.customerId,
        customer: entry.customerName,
        outstanding: entry.outstanding,
        current,
        '0-30': d0_30,
        '31-60': d31_60,
        '61-90': d61_90,
        '90+': d90plus,
        invoiceCount: entry.invoices.length,
      };
    });

    rows.sort((a, b) => b.outstanding - a.outstanding);

    return {
      total: rows.reduce((s, r) => s + r.outstanding, 0),
      rows,
    };
  }

  // Allocates payment FIFO across oldest CREDIT/PARTIAL invoices,
  // creates Payment records, and updates invoice statuses + customer outstanding.
  async recordPayment(
    id: string,
    amount: number,
    paymentMode: string,
    referenceNumber?: string,
    branchId?: string,
  ) {
    if (amount <= 0) throw new BadRequestException('Amount must be greater than zero');

    const customer = await this.findOne(id, branchId);

    // Fetch open invoices oldest-first (FIFO)
    const openInvoices = await this.prisma.invoice.findMany({
      where: {
        customerId: id,
        status: { in: ['CREDIT', 'PARTIAL'] },
      },
      orderBy: { date: 'asc' },
    });

    if (openInvoices.length === 0) {
      throw new BadRequestException('No outstanding invoices for this customer');
    }

    const totalOutstanding = openInvoices.reduce(
      (s, inv) => s + Number(inv.grandTotal) - Number(inv.amountPaid),
      0,
    );

    if (amount > totalOutstanding + 0.01) {
      throw new BadRequestException(
        `Payment amount (₹${amount.toFixed(2)}) exceeds outstanding balance (₹${totalOutstanding.toFixed(2)})`,
      );
    }

    const receiptNumber = `RCT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    return this.prisma.$transaction(async (tx) => {
      let remaining = amount;
      const allocations: { invoiceId: string; applied: number; newStatus: string }[] = [];

      for (const inv of openInvoices) {
        if (remaining <= 0.01) break;
        const due = Number(inv.grandTotal) - Number(inv.amountPaid);
        const applied = Math.min(remaining, due);
        const newAmountPaid = Number(inv.amountPaid) + applied;
        const stillDue = Number(inv.grandTotal) - newAmountPaid;
        const newStatus = stillDue <= 0.01 ? 'PAID' : 'PARTIAL';

        await tx.invoice.update({
          where: { id: inv.id },
          data: { amountPaid: newAmountPaid, status: newStatus },
        });

        allocations.push({ invoiceId: inv.id, applied, newStatus });
        remaining -= applied;
      }

      // Decrement customer outstanding by actual amount applied
      const totalApplied = amount - Math.max(0, remaining);
      await tx.customer.update({
        where: { id },
        data: { currentOutstanding: { decrement: totalApplied } },
      });

      // Create a single Payment record for the full collection
      const payment = await tx.payment.create({
        data: {
          receiptNumber,
          customerId: id,
          // link to first invoice if only one touched, else null (lump payment)
          invoiceId: allocations.length === 1 ? allocations[0].invoiceId : null,
          amount: totalApplied,
          paymentMode,
          referenceNumber: referenceNumber ?? null,
          branchId: customer.branchId ?? branchId ?? null,
        },
      });

      return {
        receiptNumber: payment.receiptNumber,
        customerId: id,
        amountRecorded: totalApplied,
        allocations,
        newOutstanding: Math.max(0, Number(customer.currentOutstanding) - totalApplied),
      };
    });
  }

  async getPaymentHistory(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.payment.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
