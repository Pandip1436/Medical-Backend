import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { InvoicePdfService } from '../pdf/invoice-pdf.service';
import { R2UploadService } from '../common/services/r2-upload.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { invoicePaymentRequestTemplate } from '../whatsapp/templates';
import { INVOICE_CREATED, PAYMENT_RECEIVED } from './invoice-events';
import type { InvoiceCreatedPayload, PaymentReceivedPayload } from './invoice-events';
import { PaymentLinkStatus } from '@prisma/client';

// Fires AFTER the BillingService.create transaction commits. Orchestrates
// the full "send invoice + payment QR to WhatsApp" flow.
//
// Feature flags (env):
//   WHATSAPP_AUTO_SEND_ENABLED  — master switch (default OFF)
//   PAY_PAGE_BASE_URL           — public pay page URL prefix
//
// Failure policy: every step is wrapped in try/catch so a Razorpay outage
// doesn't break invoice creation in the UI. Failures get logged + persisted
// to WhatsAppMessage / PaymentLink with status=FAILED for the cron sweeper.
@Injectable()
export class InvoiceCreatedListener {
  private readonly logger = new Logger(InvoiceCreatedListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly pdf: InvoicePdfService,
    private readonly r2: R2UploadService,
    private readonly whatsapp: WhatsAppService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(INVOICE_CREATED, { async: true })
  async handle(payload: InvoiceCreatedPayload) {
    if (process.env.WHATSAPP_AUTO_SEND_ENABLED !== 'true') {
      this.logger.debug(`auto-send disabled, skipping invoice ${payload.invoiceId}`);
      return;
    }
    if (payload.type !== 'INVOICE') return;
    if (payload.status === 'DRAFT' || payload.status === 'CANCELLED') return;

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: payload.invoiceId },
      include: { items: true, customer: true, branch: true },
    });
    if (!invoice) {
      this.logger.warn(`invoice ${payload.invoiceId} vanished before listener ran`);
      return;
    }
    const customer = invoice.customer;
    if (!customer) {
      this.logger.log(`invoice ${invoice.invoiceNumber} has no customer — no WhatsApp send`);
      return;
    }
    if (!customer.whatsappOptIn) {
      this.logger.log(`customer ${customer.id} opted out of WhatsApp`);
      return;
    }
    const phone = customer.whatsappNumber ?? customer.phone;
    if (!phone) {
      this.logger.log(`customer ${customer.id} has no phone for WhatsApp`);
      return;
    }

    const outstanding = Number(invoice.grandTotal) - Number(invoice.amountPaid);

    // Step 1: payment QR (only if there's outstanding to collect).
    let paymentLinkRow: { id: string; shortUrl: string } | null = null;
    if (outstanding > 0.01) {
      try {
        const link = await this.payments.createPaymentLinkForInvoice(invoice.id);
        if (link) paymentLinkRow = { id: link.id, shortUrl: link.shortUrl };
      } catch (e: any) {
        this.logger.error(`createPaymentLink failed for ${invoice.id}: ${e?.message ?? e}`);
      }
    }

    // Step 2: render PDF with QR embedded top-right.
    let pdfUrl: string | null = null;
    try {
      const buf = await this.pdf.render({
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.date,
        dueDate: invoice.dueDate,
        customerName: invoice.customerName,
        customerPhone: customer.phone,
        customerAddress: customer.address,
        customerGstin: customer.gstin,
        customerDlNumber: customer.dlNumber,
        branchName: invoice.branch?.name,
        branchGstin: invoice.branch?.gstin,
        branchAddress: invoice.branch?.address,
        branchPhone: invoice.branch?.phone,
        branchEmail: invoice.branch?.email,
        branchDlNumber: invoice.branch?.drugLicense,
        items: invoice.items.map((i) => ({
          productName: i.productName,
          batchNumber: i.batchNumber,
          expiryDate: i.expiryDate,
          quantity: i.quantity,
          mrp: Number(i.mrp),
          rate: Number(i.rate),
          discountPercent: Number(i.discountPercent),
          gstPercent: Number(i.gstPercent),
          amount: Number(i.amount),
        })),
        subtotal: Number(invoice.subtotal),
        productDiscount: Number(invoice.productDiscount),
        taxableAmount: Number(invoice.taxableAmount),
        cgst: Number(invoice.cgst),
        sgst: Number(invoice.sgst),
        igst: Number(invoice.igst),
        roundOff: Number(invoice.roundOff),
        grandTotal: Number(invoice.grandTotal),
        amountPaid: Number(invoice.amountPaid),
        paymentQrShortUrl: paymentLinkRow?.shortUrl,
        paymentQrAmount: outstanding > 0.01 ? outstanding : undefined,
      });
      const key = `invoices/${invoice.id}/${invoice.invoiceNumber}.pdf`;
      const rawPdfUrl = await this.r2.upload({
        buffer: buf,
        key,
        contentType: 'application/pdf',
      });
      // WhatsApp (and browsers) cache document media keyed by the full URL. The
      // PDF lives at a STABLE key that we overwrite on every regenerate/resend,
      // so without a per-send version param WhatsApp re-serves the FIRST PDF it
      // cached — showing a stale balance + a now-cancelled QR after counter
      // payments (e.g. message says "₹10,000 due" but the attached PDF still
      // shows "Balance ₹14,346"). A cache-busting suffix forces a fresh fetch.
      pdfUrl = `${rawPdfUrl}?v=${Date.now()}`;

      // Persist the URL on the invoice for the frontend "Resend" button.
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          paymentDetails: {
            ...(((invoice.paymentDetails as any) ?? {}) as object),
            upi: {
              pdfUrl,
              qrId: paymentLinkRow?.id ?? null,
              shortUrl: paymentLinkRow?.shortUrl ?? null,
              generatedAt: new Date().toISOString(),
            },
          } as any,
        },
      });
    } catch (e: any) {
      this.logger.error(`PDF render/upload failed for ${invoice.id}: ${e?.message ?? e}`);
      return;
    }

    if (!pdfUrl) return;

    // Step 3: send WhatsApp — receipt if fully paid at counter, payment
    // request with QR if there is still an outstanding balance.
    try {
      const customerFirstName = (customer.name ?? 'Customer').split(/\s+/)[0];

      if (outstanding <= 0.01) {
        // Fully paid at counter (cash / UPI / card). Fire a PAYMENT_RECEIVED
        // event so PaymentReceivedListener sends the receipt with the invoice
        // PDF (which already shows "Amount Paid" and no Balance Due row).
        this.eventEmitter.emit(PAYMENT_RECEIVED, {
          invoiceId: invoice.id,
          receiptNumber: invoice.invoiceNumber,
          amount: Number(invoice.grandTotal),
          paymentMode: invoice.paymentMode as string,
          referenceNumber: null,
          pdfUrl,
        } satisfies PaymentReceivedPayload);
      } else {
        // Credit or partial payment — send invoice with payment QR and Pay Now button.
        const pharmacyName = invoice.branch?.name ?? 'Pharmacy';
        const amountStr = outstanding.toFixed(2);
        // Due date: use the date entered at billing time (required for credit
        // sales on the UI). Fall back to today + 7 for legacy invoices saved
        // before the dueDate column existed.
        const due = invoice.dueDate ? new Date(invoice.dueDate) : (() => {
          const d = new Date();
          d.setDate(d.getDate() + 7);
          return d;
        })();
        const dueDate = due.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });

        const template = invoicePaymentRequestTemplate({
          customerFirstName,
          invoiceNumber: invoice.invoiceNumber,
          pharmacyName,
          amount: amountStr,
          dueDate,
          pdfUrl,
          paySlug: invoice.id,
        });

        await this.whatsapp.sendTemplate({
          to: phone,
          template,
          templateName: 'invoice_payment_request',
          mediaUrl: pdfUrl,
          bodySnapshot: `Invoice ${invoice.invoiceNumber} for ₹${amountStr}`,
          relatedEntityType: 'invoice',
          relatedEntityId: invoice.id,
          branchId: invoice.branchId,
        });

        // Mark the PaymentLink as SENT now that the customer has the QR.
        if (paymentLinkRow) {
          await this.prisma.paymentLink.update({
            where: { id: paymentLinkRow.id },
            data: { status: PaymentLinkStatus.SENT },
          });
        }
      }
    } catch (e: any) {
      this.logger.error(`WhatsApp send failed for ${invoice.id}: ${e?.message ?? e}`);
    }
  }
}
