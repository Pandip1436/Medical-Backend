import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RazorpayProvider } from './providers/razorpay.provider';
import type { PaymentProvider } from './providers/payment-provider.interface';
import { PaymentLinkStatus, PaymentProvider as PaymentProviderEnum } from '@prisma/client';

// Orchestrates the QR lifecycle for an invoice. Today only Razorpay is wired
// up — `getProvider()` is the seam where Cashfree / PayU plug in later.
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayProvider,
  ) {}

  private getProvider(): PaymentProvider {
    // When we add Cashfree, switch on .env or per-branch config here.
    return this.razorpay;
  }

  // Create a fresh QR for an invoice's CURRENT outstanding amount. If a live
  // PaymentLink already exists for the invoice (status CREATED or SENT) it is
  // closed first so we never have two open QRs against the same invoice.
  async createPaymentLinkForInvoice(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { branch: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const outstanding = Number(invoice.grandTotal) - Number(invoice.amountPaid);
    if (outstanding <= 0.01) {
      this.logger.log(`Invoice ${invoice.invoiceNumber} fully paid — no QR needed`);
      return null;
    }

    await this.closeOpenLinks(invoiceId);

    const provider = this.getProvider();
    const result = await provider.createQr({
      amount: outstanding,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customerName,
      branchId: invoice.branchId,
      branchName: invoice.branch?.name ?? null,
    });

    return this.prisma.paymentLink.create({
      data: {
        invoiceId: invoice.id,
        provider: provider.name as PaymentProviderEnum,
        providerQrId: result.providerQrId,
        shortUrl: result.shortUrl,
        qrImageUrl: result.qrImageUrl,
        amount: outstanding,
        status: PaymentLinkStatus.CREATED,
        branchId: invoice.branchId,
      },
    });
  }

  async closeOpenLinks(invoiceId: string) {
    const open = await this.prisma.paymentLink.findMany({
      where: {
        invoiceId,
        status: { in: [PaymentLinkStatus.CREATED, PaymentLinkStatus.SENT] },
      },
    });
    const provider = this.getProvider();
    for (const link of open) {
      try {
        await provider.closeQr(link.providerQrId);
      } catch (e: any) {
        // QR may already be closed/paid provider-side — log and continue so
        // we never block a cash-collection flow over a transient error.
        this.logger.warn(`closeQr failed for ${link.providerQrId}: ${e?.message ?? e}`);
      }
      await this.prisma.paymentLink.update({
        where: { id: link.id },
        data: { status: PaymentLinkStatus.CLOSED, closedAt: new Date() },
      });
    }
  }

  // Manual reconciliation poll — called by POST /billing/:id/reconcile-payment-link
  // when a webhook was missed. Returns any payments seen so the caller can
  // pass them to the reconciliation service for status updates.
  async pollPaymentsForInvoice(invoiceId: string) {
    const links = await this.prisma.paymentLink.findMany({ where: { invoiceId } });
    const provider = this.getProvider();
    const results: Array<{ link: typeof links[number]; payments: any[] }> = [];
    for (const link of links) {
      const payments = await provider.listPaymentsForQr(link.providerQrId);
      results.push({ link, payments });
    }
    return results;
  }

  getProviderForWebhook() {
    return this.getProvider();
  }

  // Has a UPI payment link (QR) ever been issued for this invoice? Used to
  // decide whether a counter payment should refresh the customer-facing QR —
  // pure-cash invoices that never got a QR are left untouched.
  async invoiceHasPaymentLink(invoiceId: string): Promise<boolean> {
    const count = await this.prisma.paymentLink.count({ where: { invoiceId } });
    return count > 0;
  }
}
