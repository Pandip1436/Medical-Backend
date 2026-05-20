import {
  Controller,
  Post,
  Headers,
  Req,
  Logger,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { ReconciliationService } from '../payments/reconciliation.service';
import { WebhookEventStatus } from '@prisma/client';

// PUBLIC ENDPOINT — Razorpay hits this server-to-server. No JWT guard.
//
// Idempotency strategy (3 layers — see plan):
//   1. WebhookEvent.providerEventId UNIQUE — first delivery wins, retries are DUPLICATE
//   2. Payment.referenceNumber index — second processing attempt no-ops in ReconciliationService
//   3. SELECT ... FOR UPDATE in ReconciliationService — cash + UPI race lock
//
// Always returns 200 after persisting the event. Processing failures don't
// bubble to Razorpay (which retries for 24h on non-2xx); a cron sweeps
// status=FAILED rows internally.
@Controller('api/v1/webhooks/razorpay')
export class RazorpayWebhookController {
  private readonly logger = new Logger(RazorpayWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: Request,
    @Headers('x-razorpay-signature') signature: string,
    @Headers('x-razorpay-event-id') eventIdHeader: string,
  ) {
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (!rawBody) {
      // RawBody must be enabled in main.ts. If we got here without it, the
      // signature check is impossible — fail closed.
      throw new BadRequestException('rawBody middleware not active');
    }

    const provider = this.payments.getProviderForWebhook();
    const valid = provider.verifyWebhookSignature(rawBody, signature ?? '');

    // Parse body separately — we still want to record the event payload even
    // if the signature is bad, so we can audit attempted spoofing.
    let body: any = {};
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      // leave body empty
    }

    const providerEventId =
      eventIdHeader || body?.payload?.payment?.entity?.id || body?.id || `${Date.now()}_${Math.random()}`;
    const eventType: string = body?.event ?? 'unknown';

    // Idempotency layer 1 — unique on providerEventId.
    let row;
    try {
      row = await this.prisma.webhookEvent.create({
        data: {
          provider: 'RAZORPAY',
          eventType,
          providerEventId,
          payloadJson: body,
          signatureValid: valid,
          status: valid ? WebhookEventStatus.RECEIVED : WebhookEventStatus.INVALID_SIGNATURE,
        },
      });
    } catch (e: any) {
      // P2002 unique violation = duplicate delivery — already handled.
      if (e?.code === 'P2002') {
        this.logger.log(`Duplicate webhook ${providerEventId} — already processed`);
        return { ok: true, duplicate: true };
      }
      throw e;
    }

    if (!valid) {
      this.logger.warn(`Invalid Razorpay signature on event ${providerEventId}`);
      // Return 200 to stop retries — invalid signature won't fix itself.
      return { ok: false, reason: 'invalid_signature' };
    }

    // Dispatch by event type. We use the Payment Links API (not QR Codes),
    // so the canonical "customer paid" event is `payment_link.paid`. We also
    // accept `payment_link.partially_paid` so partial captures get recorded.
    try {
      if (eventType === 'payment_link.paid' || eventType === 'payment_link.partially_paid') {
        const paymentEntity = body?.payload?.payment?.entity;
        const linkEntity = body?.payload?.payment_link?.entity;
        if (!paymentEntity || !linkEntity) {
          throw new Error(`${eventType} missing payment / payment_link entity`);
        }
        await this.reconciliation.handleQrCredited({
          providerQrId: linkEntity.id,        // plink_xxx — matches PaymentLink.providerQrId
          providerPaymentId: paymentEntity.id, // pay_xxx — idempotency anchor
          amount: Number(paymentEntity.amount) / 100,
          invoiceIdFromNotes: linkEntity?.notes?.invoice_id ?? null,
          paidAtUnix: paymentEntity.captured_at ?? null,
        });
      } else {
        // payment_link.expired, payment_link.cancelled, payment.failed, etc.
        // No business action — we already mark links as expired/closed at
        // the application level, and a failed payment just means try again.
        this.logger.log(`Razorpay event ${eventType} acknowledged, no handler`);
      }

      await this.prisma.webhookEvent.update({
        where: { id: row.id },
        data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date() },
      });
    } catch (e: any) {
      this.logger.error(`Webhook ${providerEventId} processing failed: ${e?.message ?? e}`);
      await this.prisma.webhookEvent.update({
        where: { id: row.id },
        data: { status: WebhookEventStatus.FAILED, errorMessage: String(e?.message ?? e) },
      });
      // Still return 200 — internal retry handled by cron, not Razorpay.
    }

    return { ok: true };
  }
}
