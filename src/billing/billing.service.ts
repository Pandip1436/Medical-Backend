import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { PaymentMode } from '@prisma/client';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createInvoiceDto: CreateInvoiceDto, userId: string, branchId?: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Generate unique invoice/quotation number
      const isQuotation = createInvoiceDto.type === 'QUOTATION';
      const prefix = isQuotation ? 'QT' : 'INV';
      const invoiceNumber = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // 2. Validate and deduct stock — only for actual invoices, not quotations
      if (!isQuotation) {
        for (const item of createInvoiceDto.items) {
          const batch = await tx.batch.findUnique({
            where: { id: item.batchId }
          });

          if (!batch) {
            throw new NotFoundException(`Batch ${item.batchNumber} for product ${item.productName} not found`);
          }

          if (batch.quantity < item.quantity) {
            throw new BadRequestException(`Insufficient stock for ${item.productName} in batch ${item.batchNumber}. Available: ${batch.quantity}`);
          }

          // Deduct from batch
          await tx.batch.update({
            where: { id: batch.id },
            data: { quantity: batch.quantity - item.quantity }
          });

          // Deduct from product total stock
          await tx.product.update({
            where: { id: item.productId },
            data: { totalStock: { decrement: item.quantity } }
          });
        }
      }

      // 3. Create the Invoice and InvoiceItems
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          type: createInvoiceDto.type,
          billingType: createInvoiceDto.billingType,
          branchId,
          customerId: createInvoiceDto.customerId,
          customerName: createInvoiceDto.customerName,
          doctorName: createInvoiceDto.doctorName,
          subtotal: createInvoiceDto.subtotal,
          productDiscount: createInvoiceDto.productDiscount,
          taxableAmount: createInvoiceDto.taxableAmount,
          cgst: createInvoiceDto.cgst,
          sgst: createInvoiceDto.sgst,
          igst: createInvoiceDto.igst || 0,
          roundOff: createInvoiceDto.roundOff,
          grandTotal: createInvoiceDto.grandTotal,
          paymentMode: createInvoiceDto.paymentMode,
          paymentDetails: createInvoiceDto.paymentDetails,
          status: createInvoiceDto.status,
          amountPaid: createInvoiceDto.amountPaid,
          changeReturned: createInvoiceDto.changeReturned,
          createdById: userId,
          items: {
            create: createInvoiceDto.items.map(item => ({
              productId: item.productId,
              productName: item.productName,
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              expiryDate: new Date(item.expiryDate),
              quantity: item.quantity,
              mrp: item.mrp,
              rate: item.rate,
              discountPercent: item.discountPercent,
              gstPercent: item.gstPercent,
              amount: item.amount
            }))
          }
        },
        include: {
          items: true
        }
      });

      // 4. If CREDIT or SPLIT payment and customer exists, update outstanding ledger
      if ((createInvoiceDto.paymentMode === 'CREDIT' || createInvoiceDto.paymentMode === 'SPLIT') && createInvoiceDto.customerId) {
        const amountAddedToCredit = createInvoiceDto.grandTotal - createInvoiceDto.amountPaid;

        if (amountAddedToCredit > 0) {
          await tx.customer.update({
            where: { id: createInvoiceDto.customerId },
            data: { currentOutstanding: { increment: amountAddedToCredit } }
          });
        }
      }

      // 5. Award loyalty points (1 point per ₹100) for non-quotation invoices
      if (createInvoiceDto.type === 'INVOICE' && createInvoiceDto.customerId) {
        const pointsEarned = Math.floor(Number(createInvoiceDto.grandTotal) / 100);
        if (pointsEarned > 0) {
          await tx.customer.update({
            where: { id: createInvoiceDto.customerId },
            data: { loyaltyPoints: { increment: pointsEarned } },
          });
        }
      }

      return invoice;
    });
  }

  findAll(query?: string, customerId?: string, branchId?: string, type?: string) {
    const where: any = {};
    if (customerId) where.customerId = customerId;
    if (branchId) where.branchId = branchId;
    if (type) where.type = type;
    if (query) {
      where.OR = [
        { invoiceNumber: { contains: query, mode: 'insensitive' } },
        { customerName: { contains: query, mode: 'insensitive' } },
      ];
    }
    return this.prisma.invoice.findMany({
      where,
      include: { items: true },
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true, createdBy: { select: { name: true } } }
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (branchId && invoice.branchId && invoice.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  async convertToInvoice(id: string, branchId?: string) {
    const quotation = await this.prisma.invoice.findUnique({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (branchId && quotation.branchId && quotation.branchId !== branchId) {
      throw new NotFoundException('Quotation not found');
    }
    if (quotation.type !== 'QUOTATION') {
      throw new BadRequestException('Only QUOTATION type records can be converted');
    }
    const invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    return this.prisma.invoice.update({
      where: { id },
      data: { type: 'INVOICE', invoiceNumber, status: 'PAID' },
      include: { items: true },
    });
  }

  async collectPayment(id: string, amountReceived: number, paymentMode: string, branchId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id } });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (branchId && invoice.branchId && invoice.branchId !== branchId) {
        throw new NotFoundException('Invoice not found');
      }

      const outstanding = Number(invoice.grandTotal) - Number(invoice.amountPaid);
      if (outstanding <= 0) {
        throw new BadRequestException('Invoice is already fully paid');
      }
      if (amountReceived <= 0) {
        throw new BadRequestException('Payment amount must be greater than zero');
      }

      const newAmountPaid = Number(invoice.amountPaid) + amountReceived;
      const stillDue = Number(invoice.grandTotal) - newAmountPaid;
      const newStatus = stillDue <= 0.01 ? 'PAID' : 'PARTIAL';

      const updated = await tx.invoice.update({
        where: { id },
        data: {
          amountPaid: newAmountPaid,
          paymentMode: paymentMode as PaymentMode,
          status: newStatus,
        },
        include: { items: true },
      });

      // Update customer outstanding
      if (invoice.customerId) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { currentOutstanding: { decrement: amountReceived } },
        });
      }

      return updated;
    });
  }

  async update(id: string, data: any, branchId?: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (branchId && invoice.branchId && invoice.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }
    return this.prisma.invoice.update({ where: { id }, data });
  }

  async remove(id: string, branchId?: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (branchId && invoice.branchId && invoice.branchId !== branchId) {
      throw new NotFoundException('Invoice not found');
    }
    return this.prisma.invoice.delete({ where: { id } });
  }

  // ── Tally XML Export ─────────────────────────────────────
  async exportTallyXml(fromDate?: string, toDate?: string, branchId?: string): Promise<string> {
    const where: any = { type: 'INVOICE' };
    if (branchId) where.branchId = branchId;
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = new Date(fromDate);
      if (toDate) where.date.lte = new Date(toDate);
    }
    const invoices = await this.prisma.invoice.findMany({
      where,
      include: { items: true },
      orderBy: { date: 'asc' },
    });

    const vouchers = invoices.map((inv) => {
      const dateStr = new Date(inv.date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '');
      const ledgerEntries = inv.items.map((item) => `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${this.escXml(item.productName)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-${Number(item.amount).toFixed(2)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`).join('');

      return `
    <VOUCHER VCHTYPE="Sales" ACTION="Create">
      <DATE>${dateStr}</DATE>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${this.escXml(inv.invoiceNumber)}</VOUCHERNUMBER>
      <PARTYLEDGERNAME>${this.escXml(inv.customerName)}</PARTYLEDGERNAME>
      <EFFECTIVEDATE>${dateStr}</EFFECTIVEDATE>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${this.escXml(inv.customerName)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${Number(inv.grandTotal).toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      ${ledgerEntries}
    </VOUCHER>`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          ${vouchers.join('')}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
  }

  private escXml(str: string): string {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ── CSV Export ────────────────────────────────────────────
  async exportCsv(fromDate?: string, toDate?: string, branchId?: string): Promise<string> {
    const where: any = { type: 'INVOICE' };
    if (branchId) where.branchId = branchId;
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = new Date(fromDate);
      if (toDate) where.date.lte = new Date(toDate);
    }
    const invoices = await this.prisma.invoice.findMany({
      where,
      include: { items: true },
      orderBy: { date: 'asc' },
    });

    const rows = [
      'Invoice No,Date,Customer,Payment Mode,Subtotal,Discount,Taxable,CGST,SGST,Grand Total,Status',
    ];
    for (const inv of invoices) {
      rows.push([
        inv.invoiceNumber,
        new Date(inv.date).toLocaleDateString('en-IN'),
        `"${inv.customerName}"`,
        inv.paymentMode,
        Number(inv.subtotal).toFixed(2),
        Number(inv.productDiscount).toFixed(2),
        Number(inv.taxableAmount).toFixed(2),
        Number(inv.cgst).toFixed(2),
        Number(inv.sgst).toFixed(2),
        Number(inv.grandTotal).toFixed(2),
        inv.status,
      ].join(','));
    }
    return rows.join('\n');
  }
}
