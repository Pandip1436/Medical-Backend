import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicePdfService } from '../pdf/invoice-pdf.service';
import { R2UploadService } from '../common/services/r2-upload.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { orderDispatchedTemplate } from '../whatsapp/templates';

// Notifies a hospital (Customer) over WhatsApp when their order (Invoice) is
// dispatched from a branch warehouse.
//
// IMPORTANT — this does NOT re-implement the Meta Cloud API. The HTTP call,
// the WhatsAppMessage audit row, and the FAILED-row retry queue all live in
// WhatsAppService.sendTemplate(). This service only:
//   1. resolves the Invoice + Customer (hospital) + Branch (warehouse),
//   2. ensures we have a public R2 URL for the invoice PDF (reusing the one the
//      invoice-created flow already produced when present),
//   3. builds the `order_dispatched` template and hands it to WhatsAppService.
//
// Failure policy: the Meta send is wrapped so a bad number / Meta outage logs
// and returns { ok: false } — it NEVER throws into the caller, so the dispatch
// action that triggered it is never rolled back. (WhatsAppService also persists
// the failure as a FAILED WhatsAppMessage row for the cron retry sweeper.)
@Injectable()
export class DispatchNotificationService {
  private readonly logger = new Logger(DispatchNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: InvoicePdfService,
    private readonly r2: R2UploadService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  // The dispatch entry point. `invoiceId` is the cuid of the Invoice that was
  // dispatched (your brief called this the "Order ID").
  //
  // Returns a small result object instead of throwing, so a controller can call
  // it fire-and-forget after marking the order dispatched without any risk to
  // the surrounding transaction.
  async notifyHospitalOnDispatch(
    invoiceId: string,
  ): Promise<{ ok: boolean; skipped?: string; messageId?: string }> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true, customer: true, branch: true },
    });
    if (!invoice) throw new NotFoundException('Invoice (order) not found');

    const hospital = invoice.customer;
    if (!hospital) {
      this.logger.log(`order ${invoice.invoiceNumber} has no customer — skipping dispatch notice`);
      return { ok: false, skipped: 'no-customer' };
    }
    if (!hospital.whatsappOptIn) {
      this.logger.log(`hospital ${hospital.id} opted out of WhatsApp — skipping dispatch notice`);
      return { ok: false, skipped: 'opted-out' };
    }
    const phone = hospital.whatsappNumber ?? hospital.phone;
    if (!phone) {
      this.logger.log(`hospital ${hospital.id} has no phone — skipping dispatch notice`);
      return { ok: false, skipped: 'no-phone' };
    }

    // Reuse the invoice PDF the billing/WhatsApp flow already rendered + uploaded
    // to R2 (stored under paymentDetails.upi.pdfUrl). Only render a fresh one if
    // it's missing — avoids double work and a second R2 object.
    let pdfUrl: string | null = this.existingPdfUrl(invoice.paymentDetails);
    if (!pdfUrl) {
      try {
        pdfUrl = await this.renderAndUploadInvoicePdf(invoice);
      } catch (e: any) {
        this.logger.error(`PDF render/upload failed for order ${invoice.id}: ${e?.message ?? e}`);
        return { ok: false, skipped: 'pdf-failed' };
      }
    }

    // Hand off to the existing, hardened Meta sender. The try/catch is belt-and-
    // braces: sendTemplate already swallows Meta API errors (logs + FAILED row)
    // and only re-throws on a raw network exception, which we also absorb here.
    try {
      const branchName = invoice.branch?.name ?? 'our';
      const template = orderDispatchedTemplate({
        hospitalName: hospital.name ?? 'Customer',
        orderNumber: invoice.invoiceNumber,
        branchName,
        pdfUrl,
      });

      const { id, providerMessageId } = await this.whatsapp.sendTemplate({
        to: phone,
        template,
        templateName: 'order_dispatched',
        mediaUrl: pdfUrl,
        bodySnapshot:
          `Hello ${hospital.name}, your order #${invoice.invoiceNumber} has been ` +
          `dispatched from our ${branchName} warehouse. Invoice attached.`,
        // Persisted so the retry sweeper can rebuild this exact template from the
        // WhatsAppMessage row without re-triggering dispatch.
        templateVars: {
          hospitalName: hospital.name,
          orderNumber: invoice.invoiceNumber,
          branchName,
          pdfUrl,
        },
        relatedEntityType: 'invoice',
        relatedEntityId: invoice.id,
        branchId: invoice.branchId,
      });

      this.logger.log(`dispatch notice queued for order ${invoice.invoiceNumber} → ${phone}`);
      return { ok: !!providerMessageId, messageId: id };
    } catch (e: any) {
      // Never let a WhatsApp failure bubble up and roll back the dispatch.
      this.logger.error(`dispatch WhatsApp send failed for order ${invoice.id}: ${e?.message ?? e}`);
      return { ok: false, skipped: 'send-failed' };
    }
  }

  // Pull the public PDF URL the invoice-created flow stashed on the invoice, if
  // it ran. Shape: paymentDetails.upi.pdfUrl (see invoice-created.listener.ts).
  private existingPdfUrl(paymentDetails: unknown): string | null {
    const upi = (paymentDetails as any)?.upi;
    return typeof upi?.pdfUrl === 'string' ? upi.pdfUrl : null;
  }

  // Fallback PDF generation, mirroring invoice-created.listener.ts so the
  // dispatched invoice looks identical to the one sent at billing time.
  private async renderAndUploadInvoicePdf(invoice: any): Promise<string> {
    const buf = await this.pdf.render({
      invoiceNumber: invoice.invoiceNumber,
      date: invoice.date,
      dueDate: invoice.dueDate,
      customerName: invoice.customerName,
      customerPhone: invoice.customer?.phone,
      customerAddress: invoice.customer?.address,
      customerGstin: invoice.customer?.gstin,
      customerDlNumber: invoice.customer?.dlNumber,
      branchName: invoice.branch?.name,
      branchGstin: invoice.branch?.gstin,
      branchAddress: invoice.branch?.address,
      branchPhone: invoice.branch?.phone,
      branchEmail: invoice.branch?.email,
      branchDlNumber: invoice.branch?.drugLicense,
      items: invoice.items.map((i: any) => ({
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
    });

    const key = `invoices/${invoice.id}/${invoice.invoiceNumber}.pdf`;
    return this.r2.upload({ buffer: buf, key, contentType: 'application/pdf' });
  }
}
