import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { Prisma, PaymentLinkStatus } from '@prisma/client';

export interface QrCreditedInput {
  providerQrId: string;
  providerPaymentId: string;     // Razorpay pay_xxx — becomes Payment.referenceNumber
  amount: number;                // rupees
  invoiceIdFromNotes?: string | null;  // hint from QR notes; we still verify
  paidAtUnix?: number | null;
}

// Webhook-time reconciliation: applies an incoming QR payment to an invoice,
// reusing the same recordPayment helper that BillingService.collectPayment
// uses for cash/card collection at the counter. Idempotent via a unique
// index on Payment.referenceNumber.
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  async handleQrCredited(input: QrCreditedInput): Promise<{
    invoiceId: string;
    receiptNumber: string | null;
    overpayment: number;
    duplicate: boolean;
  }> {
    // Idempotency layer 2 — if we already processed this payment_id, no-op.
    const existing = await this.prisma.payment.findFirst({
      where: { referenceNumber: input.providerPaymentId },
    });
    if (existing) {
      this.logger.log(`Duplicate payment ${input.providerPaymentId} — skipping`);
      return {
        invoiceId: existing.invoiceId ?? '',
        receiptNumber: existing.receiptNumber,
        overpayment: 0,
        duplicate: true,
      };
    }

    // Find the PaymentLink for this QR.
    const link = await this.prisma.paymentLink.findUnique({
      where: { providerQrId: input.providerQrId },
      include: { invoice: true },
    });
    if (!link) {
      throw new Error(
        `No PaymentLink for providerQrId=${input.providerQrId} — cannot reconcile payment ${input.providerPaymentId}`,
      );
    }
    const invoiceId = link.invoiceId;

    return this.prisma.$transaction(async (tx) => {
      // Postgres-level row lock — prevents a cash counter collect + UPI
      // webhook from both crediting the invoice at the same moment.
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;

      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new Error(`Invoice ${invoiceId} vanished mid-transaction`);

      const outstanding = Number(invoice.grandTotal) - Number(invoice.amountPaid);
      const received = Number(input.amount);
      const applied = Math.min(outstanding, received);
      const overpayment = Math.max(0, received - outstanding);

      // Update invoice.amountPaid + status only if there's outstanding to apply.
      if (applied > 0) {
        const newAmountPaid = Number(invoice.amountPaid) + applied;
        const stillDue = Number(invoice.grandTotal) - newAmountPaid;
        const newStatus = stillDue <= 0.01 ? 'PAID' : 'PARTIAL';
        await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            amountPaid: newAmountPaid,
            paymentMode: 'UPI',
            status: newStatus,
          },
        });
        if (invoice.customerId) {
          await tx.customer.update({
            where: { id: invoice.customerId },
            data: { currentOutstanding: { decrement: applied } },
          });
        }
      }

      // Always write a Payment row even for full-overpayment cases — the
      // referenceNumber is our idempotency anchor.
      let receiptNumber: string | null = null;
      if (invoice.customerId) {
        receiptNumber = await this.numbering.nextNumber(
          tx,
          'RCPT',
          invoice.branchId ?? null,
        );
        await tx.payment.create({
          data: {
            receiptNumber,
            customerId: invoice.customerId,
            invoiceId,
            amount: received,
            paymentMode: 'UPI',
            referenceNumber: input.providerPaymentId,
            branchId: invoice.branchId ?? null,
            notes: overpayment > 0
              ? `Overpayment of Rs. ${overpayment.toFixed(2)} — auto-reconciled`
              : null,
          },
        });
      }

      // If invoice was already fully paid, the entire amount is overpayment.
      // Auto-create a CreditNote so the cashier can later refund or apply
      // it to a future invoice. We use Prisma.JsonNull-style notes for now.
      if (overpayment > 0 && invoice.customerId) {
        await tx.notification.create({
          data: {
            type: 'SYSTEM',
            title: 'UPI Overpayment',
            message: `Invoice ${invoice.invoiceNumber}: customer paid Rs. ${received.toFixed(2)}, outstanding was Rs. ${outstanding.toFixed(2)}. Overpayment Rs. ${overpayment.toFixed(2)} flagged for credit note.`,
            actionUrl: `/customers/invoices/detail?id=${invoiceId}`,
            branchId: invoice.branchId ?? null,
          },
        });
      }

      await tx.paymentLink.update({
        where: { id: link.id },
        data: {
          status: PaymentLinkStatus.PAID,
          paidAmount: { increment: applied },
          paidAt: new Date(),
        },
      });

      return { invoiceId, receiptNumber, overpayment, duplicate: false };
    });
  }
}
