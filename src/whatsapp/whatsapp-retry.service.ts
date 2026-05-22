import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { INVOICE_CREATED } from '../events/invoice-events';
import type { InvoiceCreatedPayload } from '../events/invoice-events';
import { TEMPLATE_BUILDERS } from './templates';
import { WhatsAppService } from './whatsapp.service';

// Exponential backoff schedule. Index is `attempts - 1`. Capped past the last
// entry so we never wait more than 12 hours.
const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
const MAX_ATTEMPTS = 5;

// Meta error codes that NEVER succeed on retry. Sweep marks the row as
// terminally failed (attempts = MAX) so we stop reconsidering it. A few of
// these are also "user opt-out" signals — we flip `Customer.whatsappOptIn`
// to false so future invoices to that customer don't even attempt a send.
//   131048 — user has not opted in
//   131049 — user blocked the business / opted out via WhatsApp
//   131026 — recipient cannot receive messages (deleted account, etc.)
//   131051 — invalid phone number format
//   132000 — template parameter count mismatch
//   132001 — template does not exist
//   132012 — template paused for low quality
const PERMANENT_ERROR_CODES = new Set([
  '131048',
  '131049',
  '131026',
  '131051',
  '132000',
  '132001',
  '132012',
]);
const OPT_OUT_CODES = new Set(['131048', '131049', '131026']);

// Sweeps WhatsAppMessage rows with status=FAILED and re-fires the underlying
// event (invoice.created) so the listener can re-attempt the full send flow.
// Runs every 5 minutes. Skips messages until the per-attempt backoff window
// has elapsed since the last try.
//
// Why re-fire the event vs. just re-calling sendTemplate: the original
// template payload (variables) isn't stored on the message row — only the
// rendered text snapshot. The InvoiceCreatedListener already knows how to
// rebuild the payload from the invoice + customer + branch, so re-using its
// code path is the cleanest source of truth. Cost is a Razorpay round-trip
// to refresh the QR per retry; acceptable given retries are rare.
@Injectable()
export class WhatsAppRetryService {
  private readonly logger = new Logger(WhatsAppRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly whatsapp: WhatsAppService,
  ) {}

  @Cron('*/5 * * * *')
  async sweep() {
    if (process.env.WHATSAPP_AUTO_SEND_ENABLED !== 'true') {
      // Master switch off — listener is a no-op, so no FAILED rows would
      // ever exist. Saves a DB roundtrip when the feature is dormant.
      return;
    }

    const candidates = await this.prisma.whatsAppMessage.findMany({
      where: {
        status: 'FAILED',
        attempts: { lt: MAX_ATTEMPTS },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    if (candidates.length === 0) return;

    let retried = 0;
    let droppedPermanent = 0;
    let skippedBackoff = 0;

    for (const msg of candidates) {
      if (msg.errorCode && PERMANENT_ERROR_CODES.has(msg.errorCode)) {
        await this.markTerminallyFailed(msg.id);
        if (OPT_OUT_CODES.has(msg.errorCode)) {
          await this.flipCustomerOptOut(msg.to, msg.errorCode);
        }
        droppedPermanent++;
        continue;
      }

      // Backoff gate: did enough time pass since lastAttemptAt?
      const backoffIdx = Math.min(msg.attempts - 1, BACKOFF_MINUTES.length - 1);
      const backoffMs = BACKOFF_MINUTES[Math.max(0, backoffIdx)] * 60 * 1000;
      if (msg.lastAttemptAt && Date.now() - msg.lastAttemptAt.getTime() < backoffMs) {
        skippedBackoff++;
        continue;
      }

      if (msg.relatedEntityType === 'invoice' && msg.relatedEntityId) {
        const ok = await this.retryInvoiceMessage(msg.id, msg.relatedEntityId);
        if (ok) retried++;
      } else if (msg.templateVars && TEMPLATE_BUILDERS[msg.templateName]) {
        // Notification-driven senders (supplier_low_stock, sale_reminder,
        // etc.): we can't re-fire the source event without risking a
        // duplicate notification row. Rebuild the template payload directly
        // from the stored vars and call sendTemplate again. The new send
        // creates a fresh WhatsAppMessage row, so we also mark the old one
        // terminally failed to keep the sweeper from picking it up forever.
        const ok = await this.retryFromTemplateVars(msg);
        if (ok) retried++;
      } else {
        this.logger.debug(
          `Skipping retry for ${msg.id}: unsupported entity type ${msg.relatedEntityType} (no templateVars)`,
        );
      }
    }

    if (retried + droppedPermanent > 0) {
      this.logger.log(
        `sweep done — retried=${retried}, dropped_permanent=${droppedPermanent}, skipped_backoff=${skippedBackoff}`,
      );
    }
  }

  private async retryInvoiceMessage(messageId: string, invoiceId: string): Promise<boolean> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      this.logger.warn(`retry skipped: invoice ${invoiceId} not found (msg ${messageId})`);
      // Bump attempts so we don't keep re-checking a deleted invoice.
      await this.prisma.whatsAppMessage.update({
        where: { id: messageId },
        data: { attempts: MAX_ATTEMPTS },
      });
      return false;
    }

    const payload: InvoiceCreatedPayload = {
      invoiceId: invoice.id,
      branchId: invoice.branchId ?? null,
      customerId: invoice.customerId ?? null,
      type: invoice.type as InvoiceCreatedPayload['type'],
      status: invoice.status as InvoiceCreatedPayload['status'],
      grandTotal: Number(invoice.grandTotal),
      amountPaid: Number(invoice.amountPaid),
    };

    this.events.emit(INVOICE_CREATED, payload);

    await this.prisma.whatsAppMessage.update({
      where: { id: messageId },
      data: {
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });

    this.logger.log(
      `re-fired invoice.created for ${invoice.invoiceNumber} (msg ${messageId})`,
    );
    return true;
  }

  // Retry path for notification-driven senders. The original send already
  // created a WhatsAppMessage row; on success we leave that row as-is (the
  // new sendTemplate call writes a fresh row with status=SENT). We mark
  // the failed predecessor with attempts=MAX so the sweeper stops picking
  // it up — keeps the audit trail intact while removing it from the queue.
  private async retryFromTemplateVars(msg: {
    id: string;
    to: string;
    templateName: string;
    templateVars: unknown;
    bodySnapshot?: string | null;
    mediaUrl?: string | null;
    relatedEntityType: string | null;
    relatedEntityId: string | null;
    branchId: string | null;
  }): Promise<boolean> {
    const builder = TEMPLATE_BUILDERS[msg.templateName];
    if (!builder) {
      this.logger.warn(`no template builder registered for ${msg.templateName}; giving up on ${msg.id}`);
      await this.markTerminallyFailed(msg.id);
      return false;
    }
    const vars = msg.templateVars as Record<string, any>;
    try {
      await this.whatsapp.sendTemplate({
        to: msg.to,
        template: builder(vars),
        templateName: msg.templateName,
        templateVars: vars,
        bodySnapshot: msg.bodySnapshot ?? undefined,
        mediaUrl: msg.mediaUrl ?? undefined,
        relatedEntityType: msg.relatedEntityType ?? undefined,
        relatedEntityId: msg.relatedEntityId ?? undefined,
        branchId: msg.branchId,
      });
      // The new attempt got its own row; retire the failed predecessor.
      await this.markTerminallyFailed(msg.id);
      this.logger.log(`re-sent ${msg.templateName} from templateVars (msg ${msg.id})`);
      return true;
    } catch (e: any) {
      // Bump attempts on the failed row so backoff progresses; sendTemplate
      // itself already wrote a fresh FAILED row if Meta rejected.
      await this.prisma.whatsAppMessage.update({
        where: { id: msg.id },
        data: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
      });
      this.logger.error(`retryFromTemplateVars failed for ${msg.id}: ${e?.message ?? e}`);
      return false;
    }
  }

  private async markTerminallyFailed(messageId: string) {
    await this.prisma.whatsAppMessage.update({
      where: { id: messageId },
      data: { attempts: MAX_ATTEMPTS },
    });
  }

  // Meta opt-out signal: stop messaging this customer forever (until they
  // explicitly re-opt in via the customer form toggle).
  private async flipCustomerOptOut(to: string, errorCode: string) {
    const digits = to.replace(/\D/g, '');
    const last10 = digits.slice(-10);

    const customer = await this.prisma.customer.findFirst({
      where: {
        OR: [
          { phone: digits },
          { phone: last10 },
          { whatsappNumber: digits },
          { whatsappNumber: last10 },
        ],
      },
    });

    if (!customer) {
      this.logger.warn(
        `opt-out signal (code ${errorCode}) for ${to} but no matching customer found`,
      );
      return;
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { whatsappOptIn: false },
    });

    // Log to in-app notifications so admins know a customer auto-opted out.
    await this.prisma.notification.create({
      data: {
        type: 'SYSTEM',
        title: 'Customer opted out of WhatsApp',
        message: `${customer.name} (${customer.phone}) was auto-opted out of WhatsApp messages after Meta signal (code ${errorCode}).`,
        actionUrl: `/customers/detail?id=${customer.id}`,
        branchId: customer.branchId ?? null,
      },
    });

    this.logger.log(
      `customer ${customer.id} (${customer.name}) auto-opted out: Meta code ${errorCode}`,
    );
  }
}
