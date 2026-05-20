// Meta WhatsApp template builders. Each function returns the `template`
// object Meta expects under POST /{phone_number_id}/messages.
//
// Templates must be pre-approved in Meta Business Manager before they will
// deliver. Submit the literal text below — Meta usually approves UTILITY
// category templates in 24-48h.

export interface InvoicePaymentRequestVars {
  customerFirstName: string;
  invoiceNumber: string;
  pharmacyName: string;
  amount: string;        // "1,500.00"
  dueDate: string;       // "15 May 2026"
  pdfUrl: string;        // signed/public URL to the invoice PDF
  paySlug: string;       // URL button suffix (short code or invoice id)
  languageCode?: string; // default en_US
}

export function invoicePaymentRequestTemplate(v: InvoicePaymentRequestVars) {
  return {
    name: 'invoice_payment_request',
    language: { code: v.languageCode ?? 'en_US' },
    components: [
      {
        type: 'header',
        parameters: [
          {
            type: 'document',
            document: {
              link: v.pdfUrl,
              filename: `Invoice_${v.invoiceNumber}.pdf`,
            },
          },
        ],
      },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: v.customerFirstName },
          { type: 'text', text: v.invoiceNumber },
          { type: 'text', text: v.pharmacyName },
          { type: 'text', text: v.amount },
          { type: 'text', text: v.dueDate },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: v.paySlug }],
      },
    ],
  };
}

export interface PaymentReceivedVars {
  customerFirstName: string;
  amount: string;
  invoiceNumber: string;
  receiptNumber: string;
  languageCode?: string;
}

export function paymentReceivedTemplate(v: PaymentReceivedVars) {
  return {
    name: 'payment_received',
    language: { code: v.languageCode ?? 'en_US' },
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: v.customerFirstName },
          { type: 'text', text: v.amount },
          { type: 'text', text: v.invoiceNumber },
          { type: 'text', text: v.receiptNumber },
        ],
      },
    ],
  };
}
