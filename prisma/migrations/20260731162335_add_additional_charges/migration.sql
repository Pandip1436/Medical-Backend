-- User-defined extra charges (Commission, Handling, …) on invoices & quotations.
-- JSONB array of { label, amount }; non-taxable add-ons already folded into
-- grandTotal by the client. IF NOT EXISTS keeps it safe on envs where the column
-- may already exist from a prior db push.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "additionalCharges" JSONB;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "additionalCharges" JSONB;
