-- ─────────────────────────────────────────────────────────────
-- Invoice edit audit: tracks who edited an unpaid/partial invoice,
-- with before/after snapshots for accountability.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "InvoiceEditAudit" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "branchId" TEXT,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,

    CONSTRAINT "InvoiceEditAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceEditAudit_invoiceId_idx" ON "InvoiceEditAudit"("invoiceId");
CREATE INDEX "InvoiceEditAudit_editedAt_idx" ON "InvoiceEditAudit"("editedAt");

ALTER TABLE "InvoiceEditAudit" ADD CONSTRAINT "InvoiceEditAudit_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceEditAudit" ADD CONSTRAINT "InvoiceEditAudit_editedById_fkey"
    FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
