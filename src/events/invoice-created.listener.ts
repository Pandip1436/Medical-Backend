import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { InvoicePdfService } from '../pdf/invoice-pdf.service';
import { R2UploadService } from '../common/services/r2-upload.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppSettingsService } from '../whatsapp/whatsapp-settings.service';
import { invoicePaymentRequestTemplate } from '../whatsapp/templates';
import { INVOICE_CREATED, PAYMENT_RECEIVED } from './invoice-events';
import type { InvoiceCreatedPayload, PaymentReceivedPayload } from './invoice-events';
import { PaymentLinkStatus } from '@prisma/client';
import { withTimeout, TimeoutError } from '../common/utils/with-timeout.util';
import { resolveWhatsAppPhone } from '../common/utils/whatsapp-phone.util';

// Why the send did (or didn't) happen. Returned to the manual
// POST /billing/:id/send-whatsapp endpoint so the operator gets the actual
// reason instead of a generic "skipped" — see BillingService.emitInvoiceCreatedById.
export type SendOutcome =
  | 'SENT'
  | 'RECEIPT_QUEUED'         // fully paid at counter → PaymentReceivedListener sends
  | 'ALREADY_IN_PROGRESS'
  | 'AUTO_SEND_DISABLED'
  | 'NOT_AN_INVOICE'
  | 'INVOICE_NOT_ELIGIBLE'
  | 'INVOICE_NOT_FOUND'
  | 'NO_CUSTOMER'
  | 'CUSTOMER_OPTED_OUT'
  | 'NO_PHONE'
  | 'ALREADY_SENT'
  | 'PDF_FAILED'
  | 'SEND_FAILED'
  | 'TIMED_OUT';

export interface SendResult {
  outcome: SendOutcome;
  detail?: string;
}

// Hard ceiling on one end-to-end run (payment link + PDF render + upload + the
// Meta call). Each individual call is bounded too; this is the backstop that
// guarantees handle() always settles, so the in-flight guard below always
// unwinds and the operator's request always gets an answer.
const HANDLE_TIMEOUT_MS = 90_000;

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
  // In-process guard: prevents concurrent handle() calls for the same invoice
  // from racing through the idempotency check simultaneously. This covers both
  // the listener-accumulation scenario (duplicate @OnEvent registrations due to
  // double module import) and rapid concurrent API calls to POST /send-whatsapp.
  //
  // Keyed by start time, not a bare Set: entries used to be removed only in the
  // `finally` below, so a run that never settled (an external call with no
  // timeout) left its invoice marked in-flight for the life of the process —
  // every later attempt was dropped here and surfaced to the operator as an
  // unexplained "skipped". Timeouts should make that unreachable; the staleness
  // sweep is the belt-and-braces that keeps one wedged run from being permanent.
  private readonly processing = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly pdf: InvoicePdfService,
    private readonly r2: R2UploadService,
    private readonly whatsapp: WhatsAppService,
    private readonly whatsappSettings: WhatsAppSettingsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(INVOICE_CREATED, { async: true })
  async handle(payload: InvoiceCreatedPayload): Promise<SendResult> {
    const startedAt = this.processing.get(payload.invoiceId);
    if (startedAt !== undefined) {
      const ageMs = Date.now() - startedAt;
      // Only a genuinely concurrent run blocks. Anything older than the hard
      // timeout can't still be running, so treat it as debris and take over.
      if (ageMs < HANDLE_TIMEOUT_MS) {
        this.logger.warn(
          `duplicate handle() for invoice ${payload.invoiceId} — dropped, a run started ${Math.round(ageMs / 1000)}s ago is still in flight`,
        );
        return { outcome: 'ALREADY_IN_PROGRESS', detail: `in flight for ${Math.round(ageMs / 1000)}s` };
      }
      this.logger.warn(
        `stale in-flight marker for invoice ${payload.invoiceId} (${Math.round(ageMs / 1000)}s old) — clearing and retrying`,
      );
    }
    this.processing.set(payload.invoiceId, Date.now());
    try {
      return await withTimeout(this._handle(payload), HANDLE_TIMEOUT_MS, `invoice.created ${payload.invoiceId}`);
    } catch (e: any) {
      // _handle catches its own step failures, so reaching here means the whole
      // run blew its budget. Report it rather than leaving the caller guessing.
      this.logger.error(`handle() failed for invoice ${payload.invoiceId}: ${e?.message ?? e}`);
      return {
        outcome: e instanceof TimeoutError ? 'TIMED_OUT' : 'SEND_FAILED',
        detail: e?.message ?? String(e),
      };
    } finally {
      this.processing.delete(payload.invoiceId);
    }
  }

  private async _handle(payload: InvoiceCreatedPayload): Promise<SendResult> {
    if (!(await this.whatsappSettings.isEnabled('invoiceAutoSend'))) {
      this.logger.debug(`auto-send disabled, skipping invoice ${payload.invoiceId}`);
      return { outcome: 'AUTO_SEND_DISABLED' };
    }
    if (payload.type !== 'INVOICE') return { outcome: 'NOT_AN_INVOICE' };
    if (payload.status === 'DRAFT' || payload.status === 'CANCELLED') {
      return { outcome: 'INVOICE_NOT_ELIGIBLE', detail: payload.status };
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: payload.invoiceId },
      include: { items: true, customer: true, branch: true },
    });
    if (!invoice) {
      this.logger.warn(`invoice ${payload.invoiceId} vanished before listener ran`);
      return { outcome: 'INVOICE_NOT_FOUND' };
    }
    const customer = invoice.customer;
    if (!customer) {
      this.logger.log(`invoice ${invoice.invoiceNumber} has no customer — no WhatsApp send`);
      return { outcome: 'NO_CUSTOMER' };
    }
    if (!customer.whatsappOptIn) {
      this.logger.log(`customer ${customer.id} opted out of WhatsApp`);
      return { outcome: 'CUSTOMER_OPTED_OUT' };
    }
    const phone = resolveWhatsAppPhone(customer);
    if (!phone) {
      this.logger.log(`customer ${customer.id} has no phone for WhatsApp`);
      return { outcome: 'NO_PHONE' };
    }

    // Idempotency: if this invoice already has a WhatsApp message that reached
    // Meta (SENT/DELIVERED/READ), don't send again. The retry sweep re-fires
    // this event, and Meta can spuriously flip a delivered message to FAILED —
    // without this guard every such retry would deliver a DUPLICATE to the
    // customer AND spawn a new message row, which is exactly the runaway loop
    // that sent 1000+ copies. Manual "Resend" sets forceResend to bypass this.
    if (!payload.forceResend) {
      // "Already accepted by Meta" = a message row that either reached a
      // success state OR carries a providerMessageId (Meta returned a wamid,
      // i.e. it accepted the send even if a later webhook flipped it to
      // FAILED). A send-time failure (non-2xx) has no wamid and IS retryable.
      const alreadyAccepted = await this.prisma.whatsAppMessage.count({
        where: {
          relatedEntityId: invoice.id,
          relatedEntityType: 'invoice',
          OR: [
            { providerMessageId: { not: null } },
            { status: { in: ['QUEUED', 'SENT', 'DELIVERED', 'READ'] } },
          ],
        },
      });
      if (alreadyAccepted > 0) {
        this.logger.log(
          `invoice ${invoice.invoiceNumber} already accepted by Meta — skipping resend`,
        );
        return { outcome: 'ALREADY_SENT' };
      }
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
        // Printed in the header band, matching the client's challan stationery.
        salespersonName: invoice.salespersonName,
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
        deliveryCharge: Number(invoice.deliveryCharge),
        additionalCharges: (invoice.additionalCharges as any) ?? [],
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
      return { outcome: 'PDF_FAILED', detail: e?.message ?? String(e) };
    }

    if (!pdfUrl) return { outcome: 'PDF_FAILED', detail: 'no PDF URL produced' };

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
        return { outcome: 'RECEIPT_QUEUED' };
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
        return { outcome: 'SENT' };
      }
    } catch (e: any) {
      this.logger.error(`WhatsApp send failed for ${invoice.id}: ${e?.message ?? e}`);
      return { outcome: 'SEND_FAILED', detail: e?.message ?? String(e) };
    }
  }
}
