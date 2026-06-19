-- Link a REPLACEMENT credit note to the no-charge sales invoice raised to hand
-- the replacement goods to the customer. Set (with settledAt) once the
-- replacement is issued, so a REPLACEMENT CN can be marked settled = delivered.
ALTER TABLE "CreditNote" ADD COLUMN IF NOT EXISTS "replacementInvoiceId" TEXT;
