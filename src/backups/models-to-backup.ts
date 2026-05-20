// Explicit allowlist of Prisma models to include in a JSONL backup.
//
// Order matters — listed parents-before-children so a future restore script
// can replay rows in the same sequence (FK constraints will be satisfied).
//
// Excluded by design:
//   - Notification        : regenerable from underlying data (low-stock, expiry, etc.)
//   - SharedFile          : transient public PDF links, expire on their own
//   - WebhookEvent        : provider receipts log, retention 30 days
//   - IntegrationCredential : holds secrets — NEVER include in a backup
//   - IntegrationSyncJob  : job audit log, regenerable
//   - StockAdjustmentLog  : large append-only log, not critical for restore
//   - Backup (this table) : avoid recursion
//   - _prisma_migrations  : managed by Prisma CLI, not via the client
export interface BackupModel {
  /** Friendly name written into the JSONL `_table` delimiter. */
  name: string;
  /** Key on the Prisma client (camelCase model name). */
  prismaKey: string;
}

export const MODELS_TO_BACKUP: BackupModel[] = [
  // ── Core identity / org structure ──
  { name: 'Branch',                prismaKey: 'branch' },
  { name: 'User',                  prismaKey: 'user' },

  // ── Master data ──
  { name: 'Category',              prismaKey: 'category' },
  { name: 'Doctor',                prismaKey: 'doctor' },
  { name: 'Supplier',              prismaKey: 'supplier' },
  { name: 'Customer',              prismaKey: 'customer' },
  { name: 'Product',               prismaKey: 'product' },
  { name: 'Batch',                 prismaKey: 'batch' },

  // ── CRM ──
  { name: 'Company',               prismaKey: 'company' },
  { name: 'Contact',               prismaKey: 'contact' },
  { name: 'Lead',                  prismaKey: 'lead' },
  { name: 'LeadActivity',          prismaKey: 'leadActivity' },

  // ── Sales ──
  { name: 'Quotation',             prismaKey: 'quotation' },
  { name: 'QuotationItem',         prismaKey: 'quotationItem' },
  { name: 'Invoice',               prismaKey: 'invoice' },
  { name: 'InvoiceItem',           prismaKey: 'invoiceItem' },
  { name: 'CreditNote',            prismaKey: 'creditNote' },
  { name: 'CreditNoteItem',        prismaKey: 'creditNoteItem' },

  // ── Purchase ──
  { name: 'PurchaseOrder',         prismaKey: 'purchaseOrder' },
  { name: 'PurchaseOrderItem',     prismaKey: 'purchaseOrderItem' },
  { name: 'GRN',                   prismaKey: 'gRN' },
  { name: 'GRNItem',               prismaKey: 'gRNItem' },
  { name: 'PurchaseReturn',        prismaKey: 'purchaseReturn' },
  { name: 'PurchaseReturnItem',    prismaKey: 'purchaseReturnItem' },

  // ── Finance ──
  { name: 'Expense',               prismaKey: 'expense' },
  { name: 'Payment',               prismaKey: 'payment' },
  { name: 'PaymentLink',           prismaKey: 'paymentLink' },

  // ── Workflow / governance ──
  { name: 'ApprovalRequest',       prismaKey: 'approvalRequest' },
  { name: 'AuditLog',              prismaKey: 'auditLog' },
  { name: 'SupplierActivity',      prismaKey: 'supplierActivity' },
  { name: 'CustomerActivity',      prismaKey: 'customerActivity' },

  // ── Misc ──
  { name: 'Prescription',          prismaKey: 'prescription' },
  { name: 'CustomerReminder',      prismaKey: 'customerReminder' },
  { name: 'ReminderContact',       prismaKey: 'reminderContact' },
  { name: 'WhatsAppMessage',       prismaKey: 'whatsAppMessage' },
  { name: 'DiscountRule',          prismaKey: 'discountRule' },

  // ── Settings / numbering ──
  { name: 'GlobalSetting',         prismaKey: 'globalSetting' },
  { name: 'NumberingConfig',       prismaKey: 'numberingConfig' },
  { name: 'DocumentSequence',      prismaKey: 'documentSequence' },
];
