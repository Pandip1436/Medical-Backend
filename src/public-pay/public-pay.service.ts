import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Read-only view-model for the customer-facing /pay/:invoiceId page.
// Deliberately narrow — exposes ONLY the fields a customer needs to pay.
// Specifically excludes: line items, prescriptions, doctor info, other
// invoices, customer credit history, salesperson info, internal IDs other
// than the invoice id itself.
export interface PublicPayView {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;          // ISO
  customerFirstName: string;    // first token only — no full name leak
  pharmacyName: string;
  branchPhone: string | null;
  amount: number;               // grandTotal
  amountPaid: number;
  outstanding: number;
  status: string;               // InvoiceStatus
  paymentLink: {
    qrImageUrl: string;
    shortUrl: string;
    status: string;             // PaymentLinkStatus
    amount: number;
    paidAmount: number;
    paidAt: string | null;
  } | null;
}

@Injectable()
export class PublicPayService {
  constructor(private readonly prisma: PrismaService) {}

  async getPayView(invoiceId: string): Promise<PublicPayView> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoiceNumber: true,
        date: true,
        customerName: true,
        grandTotal: true,
        amountPaid: true,
        status: true,
        type: true,
        branch: { select: { name: true, phone: true } },
        paymentLinks: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            qrImageUrl: true,
            shortUrl: true,
            status: true,
            amount: true,
            paidAmount: true,
            paidAt: true,
          },
        },
      },
    });

    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.type !== 'INVOICE') {
      // Quotations don't have an outstanding amount in the same sense — and
      // we don't want this URL to return data for arbitrary lookups beyond
      // billable invoices. Surface a 404 instead of leaking quotation data.
      throw new NotFoundException('Invoice not found');
    }

    const grandTotal = Number(invoice.grandTotal);
    const amountPaid = Number(invoice.amountPaid);
    const outstanding = Math.max(0, grandTotal - amountPaid);
    const link = invoice.paymentLinks[0] ?? null;

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.date.toISOString(),
      customerFirstName: (invoice.customerName ?? 'Customer').split(/\s+/)[0],
      pharmacyName: invoice.branch?.name ?? 'Pharmacy',
      branchPhone: invoice.branch?.phone ?? null,
      amount: grandTotal,
      amountPaid,
      outstanding,
      status: invoice.status,
      paymentLink: link
        ? {
            qrImageUrl: link.qrImageUrl,
            shortUrl: link.shortUrl,
            status: link.status,
            amount: Number(link.amount),
            paidAmount: Number(link.paidAmount),
            paidAt: link.paidAt ? link.paidAt.toISOString() : null,
          }
        : null,
    };
  }
}
