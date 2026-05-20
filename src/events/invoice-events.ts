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
