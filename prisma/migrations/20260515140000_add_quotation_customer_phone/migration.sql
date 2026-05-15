-- AlterTable: Quotation gains a customerPhone column so quotations can be
-- created with only name + phone (no Customer master record). Stored on the
-- quotation row itself so the data survives long gaps before the customer
-- comes back to confirm and the quote is converted to an invoice.
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
