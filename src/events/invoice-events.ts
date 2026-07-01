// Event payloads emitted by BillingService and consumed by listeners.
// Keeping the shape narrow (no full Invoice object) so the listener has to
// re-fetch — keeps the contract stable as the invoice schema evolves.

export const INVOICE_CREATED = 'invoice.created' as const;

export interface InvoiceCreatedPayload {
  invoiceId: string;
  branchId: string | null;
  customerId: string | null;
  type: 'INVOICE' | 'QUOTATION';
  status: 'DRAFT' | 'PAID' | 'UNPAID' | 'PARTIAL' | 'RETURNED' | 'CANCELLED';
  grandTotal: number;
  amountPaid: number;
}

export const PAYMENT_RECEIVED = 'payment.received' as const;

export interface PaymentReceivedPayload {
  invoiceId: string;
  receiptNumber: string;
  amount: number;
  paymentMode: string;
  referenceNumber?: string | null;
  // Pre-generated invoice PDF URL (counter/cash sales). When absent the
  // listener generates a compact receipt PDF via ReceiptPdfService.
  pdfUrl?: string | null;
}
