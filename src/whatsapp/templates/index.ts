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

// Sent to the supplier when one of their products goes below minStock. Body-
// only template (no document, no buttons) — keeps Meta review simple and
// avoids needing a hosted PDF.
//
// Meta template literal to register (UTILITY category, en_US):
//   Hello {{1}}, this is {{2}} pharmacy.
//   We're running low on {{3}}.
//   Current stock: {{4}} units (minimum: {{5}}).
//   Suggested reorder: {{6}} units.
//   Please confirm availability and price.
export interface LowStockSupplierVars {
  supplierContactName: string;  // contactPerson, fallback supplier.name
  pharmacyName: string;          // branch name (fallback "the pharmacy")
  productName: string;
  currentStock: string;          // "12"
  minStock: string;              // "20"
  reorderQty: string;            // "40"
  languageCode?: string;
}

export function lowStockSupplierTemplate(v: LowStockSupplierVars) {
  return {
    name: 'low_stock_supplier_alert',
    language: { code: v.languageCode ?? 'en_US' },
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: v.supplierContactName },
          { type: 'text', text: v.pharmacyName },
          { type: 'text', text: v.productName },
          { type: 'text', text: v.currentStock },
          { type: 'text', text: v.minStock },
          { type: 'text', text: v.reorderQty },
        ],
      },
    ],
  };
}

// Sent to a customer on the day-of-month their CustomerReminder is due
// (e.g. "buys diabetes meds on the 15th every month"). Body-only template,
// no media or buttons — keeps Meta review trivial.
//
// Meta template literal to register (UTILITY category, en_US):
//   Hello {{1}}, this is your monthly reminder from {{2}}: {{3}}.
//   Please let us know if you'd like us to prepare anything for you.
export interface CustomerSaleReminderVars {
  customerFirstName: string;
  pharmacyName: string;         // branch name (fallback "your pharmacy")
  reminderTitle: string;        // the CustomerReminder.title text
  languageCode?: string;
}

export function customerSaleReminderTemplate(v: CustomerSaleReminderVars) {
  return {
    name: 'customer_sale_reminder',
    language: { code: v.languageCode ?? 'en_US' },
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: v.customerFirstName },
          { type: 'text', text: v.pharmacyName },
          { type: 'text', text: v.reminderTitle },
        ],
      },
    ],
  };
}

// Sent to a hospital/customer when their order (Invoice) is dispatched from a
// branch warehouse. Carries the official invoice PDF as a header document so
// the recipient can download it natively in WhatsApp — no raw link needed.
//
// Meta template literal to register (UTILITY category, en_US) with a DOCUMENT
// header:
//   Header:  [document]
//   Body:
//     Hello {{1}}, your order #{{2}} has been dispatched from our {{3}}
//     warehouse. Your official invoice is attached above.
//     Thank you for your order.
export interface OrderDispatchedVars {
  hospitalName: string;   // customer.name (full name, e.g. "City General Hospital")
  orderNumber: string;    // invoice.invoiceNumber — the doc number the hospital recognises
  branchName: string;     // dispatching branch/warehouse name
  pdfUrl: string;         // public R2 URL to the invoice PDF
  languageCode?: string;  // default en_US
}

export function orderDispatchedTemplate(v: OrderDispatchedVars) {
  return {
    name: 'order_dispatched',
    language: { code: v.languageCode ?? 'en_US' },
    components: [
      {
        type: 'header',
        parameters: [
          {
            type: 'document',
            document: {
              link: v.pdfUrl,
              filename: `Invoice_${v.orderNumber}.pdf`,
            },
          },
        ],
      },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: v.hospitalName },
          { type: 'text', text: v.orderNumber },
          { type: 'text', text: v.branchName },
        ],
      },
    ],
  };
}

// Registry of every template name → builder. The retry sweeper uses this to
// rebuild a Meta template payload from the `templateVars` JSON stored on a
// failed WhatsAppMessage row, without needing to re-fire the source event.
// Required for senders where re-firing would risk duplicating downstream
// state (e.g. notification-driven flows).
//
// When you add a new template builder above, also add it here.
export type TemplateBuilder = (vars: any) => Record<string, any>;
export const TEMPLATE_BUILDERS: Record<string, TemplateBuilder> = {
  invoice_payment_request: invoicePaymentRequestTemplate,
  payment_received: paymentReceivedTemplate,
  low_stock_supplier_alert: lowStockSupplierTemplate,
  customer_sale_reminder: customerSaleReminderTemplate,
  order_dispatched: orderDispatchedTemplate,
};
