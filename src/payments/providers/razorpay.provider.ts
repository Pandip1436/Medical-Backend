import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import Razorpay from 'razorpay';
import { R2UploadService } from '../../common/services/r2-upload.service';
import { withTimeout, timeoutFromEnv } from '../../common/utils/with-timeout.util';
import type {
  CreateQrInput,
  CreateQrResult,
  PaymentProvider,
  QrPayment,
} from './payment-provider.interface';

// Razorpay Payment Links API
//   https://razorpay.com/docs/api/payments/payment-links/
//
// We originally planned to use the QR Codes API (which has no expiry), but
// that endpoint is gated behind per-account activation and isn't on by
// default for new merchants. Payment Links are available immediately.
//
// Trade-off vs QR Codes:
//   - max expiry 1 year (vs unlimited for QR Codes)
//   - covers ~all credit cycles; admins can regenerate for the rare case
//   - Razorpay returns a `short_url` only — we generate the UPI QR ourselves
//     from that URL using `qrcode` and upload the PNG to R2 so we have a
//     stable image URL to embed in the WhatsApp template + invoice PDF.
@Injectable()
export class RazorpayProvider implements PaymentProvider, OnModuleInit {
  readonly name = 'RAZORPAY' as const;
  private readonly logger = new Logger(RazorpayProvider.name);
  private client: Razorpay | null = null;

  constructor(private readonly r2: R2UploadService) {}

  onModuleInit() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      this.logger.warn(
        'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — RazorpayProvider will throw on use',
      );
      return;
    }
    this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  // The Razorpay SDK sets no socket timeout, so a stalled request hangs the
  // caller indefinitely. Every call below is bounded; see with-timeout.util.
  private get callTimeoutMs(): number {
    return timeoutFromEnv('RAZORPAY_TIMEOUT_MS', 20_000);
  }

  private requireClient(): Razorpay {
    if (!this.client) {
      throw new Error(
        'RazorpayProvider not initialised — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env',
      );
    }
    return this.client;
  }

  async createQr(input: CreateQrInput): Promise<CreateQrResult> {
    const client = this.requireClient();
    // Razorpay expects paise. Clamp to 100 paise (₹1) minimum.
    const paise = Math.max(100, Math.round(Number(input.amount) * 100));

    // Expiry: 1 year from now (Razorpay's max). Admins can regenerate via the
    // "Generate QR" button if a credit invoice ever sits unpaid > 11 months.
    const expireBy = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

    // reference_id must be unique. Suffix with timestamp so regenerating a
    // QR for the same invoice (after partial cash collection) doesn't 409.
    const referenceId = `${input.invoiceId}-${Date.now()}`;

    // Full customer object so Razorpay shows name + contact + email under
    // "Customer detail" in the dashboard (previously we sent only the name,
    // so the list column fell back to the payer's UPI-registered phone).
    const customer: { name?: string; contact?: string; email?: string } = {};
    if (input.customerName) customer.name = input.customerName;
    if (input.customerPhone) {
      const digits = String(input.customerPhone).replace(/\D/g, '');
      // Razorpay wants an E.164-ish contact; assume India for bare 10-digit numbers.
      customer.contact = digits.length === 10 ? `+91${digits}` : String(input.customerPhone).trim();
    }
    if (input.customerEmail) customer.email = input.customerEmail;

    const link = await withTimeout<any>(
      (client.paymentLink as any).create({
        amount: paise,
        currency: 'INR',
        accept_partial: false,
        description: `Invoice ${input.invoiceNumber}`,
        reference_id: referenceId,
        expire_by: expireBy,
        customer: Object.keys(customer).length ? customer : undefined,
        // We handle WhatsApp delivery ourselves via Meta Cloud API — disable
        // Razorpay's built-in SMS/email so customers don't get duplicate
        // messages from Razorpay's domain.
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: {
          invoice_id: input.invoiceId,
          invoice_number: input.invoiceNumber,
          branch_id: input.branchId ?? '',
          customer_name: input.customerName ?? '',
          customer_phone: input.customerPhone ?? '',
        },
      }),
      this.callTimeoutMs,
      'razorpay.paymentLink.create',
    );

    // Generate the UPI QR ourselves from the short_url. Customer scans →
    // phone opens the URL → Razorpay's hosted page detects mobile UA and
    // launches the UPI app picker (GPay/PhonePe/Paytm/BHIM).
    const qrPng = await QRCode.toBuffer(link.short_url, { width: 480, margin: 1 });
    const qrKey = `payment-qr/${input.invoiceId}/${link.id}.png`;
    const qrImageUrl = await this.r2.upload({
      buffer: qrPng,
      key: qrKey,
      contentType: 'image/png',
    });

    return {
      providerQrId: link.id,
      shortUrl: link.short_url,
      qrImageUrl,
    };
  }

  async closeQr(providerQrId: string): Promise<void> {
    const client = this.requireClient();
    // Cancel the payment link so it can no longer accept payments. Used when
    // a fresh QR is generated for the same invoice after partial cash
    // collection (so two open links can't both be paid).
    await withTimeout(
      (client.paymentLink as any).cancel(providerQrId),
      this.callTimeoutMs,
      'razorpay.paymentLink.cancel',
    );
  }

  async listPaymentsForQr(providerQrId: string): Promise<QrPayment[]> {
    const client = this.requireClient();
    // Manual reconciliation: fetch the payment link, look at its `payments`
    // array. Used when a webhook was missed.
    const link: any = await withTimeout<any>(
      (client.paymentLink as any).fetch(providerQrId),
      this.callTimeoutMs,
      'razorpay.paymentLink.fetch',
    );
    const items: any[] = link?.payments ?? [];
    return items.map((p) => ({
      providerPaymentId: p.payment_id ?? p.id,
      amount: Number(p.amount) / 100,
      status: p.status, // 'captured' | 'failed' | 'created' | ...
      capturedAt: p.created_at ? new Date(p.created_at * 1000) : null,
      vpa: p.method === 'upi' ? (p.upi?.vpa ?? null) : null,
    }));
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
    const secrets = [
      process.env.RAZORPAY_WEBHOOK_SECRET,
      process.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS,
    ].filter((s): s is string => !!s);

    if (secrets.length === 0 || !signatureHeader) return false;

    for (const secret of secrets) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
      try {
        const sigBuf = Buffer.from(signatureHeader, 'utf8');
        const expBuf = Buffer.from(expected, 'utf8');
        if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
          return true;
        }
      } catch {
        // length mismatch on timingSafeEqual — keep trying other secrets
      }
    }
    return false;
  }
}
