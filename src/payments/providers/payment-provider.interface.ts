// Provider-agnostic interface so we can swap Razorpay for Cashfree (or add
// another rail) without touching the orchestration layer. Every gateway we
// integrate must be able to: create a UPI QR, close it, and look up
// payments-against-it for manual reconciliation when a webhook is missed.

export interface CreateQrInput {
  amount: number;            // rupees (provider impls convert to paise / sub-units)
  invoiceId: string;
  invoiceNumber: string;
  customerName?: string | null;
  branchId?: string | null;
  branchName?: string | null;
}

export interface CreateQrResult {
  providerQrId: string;       // e.g. Razorpay qr_xxx
  shortUrl: string;
  qrImageUrl: string;
}

export interface QrPayment {
  providerPaymentId: string;  // e.g. Razorpay pay_xxx
  amount: number;             // rupees
  status: string;             // provider-native, normalised by caller
  capturedAt: Date | null;
  vpa?: string | null;        // payer UPI handle if available
}

export interface PaymentProvider {
  readonly name: 'RAZORPAY' | 'CASHFREE';
  createQr(input: CreateQrInput): Promise<CreateQrResult>;
  closeQr(providerQrId: string): Promise<void>;
  // Manual reconciliation: pull all payments captured against a QR. Used by
  // POST /billing/:id/reconcile-payment-link when a webhook went missing.
  listPaymentsForQr(providerQrId: string): Promise<QrPayment[]>;
  // Webhook signature verification — given the raw body buffer + header,
  // confirm Meta/Razorpay actually sent this.
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean;
}
