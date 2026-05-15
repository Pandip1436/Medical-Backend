-- AlterTable: Invoice and Quotation gain a deliveryCharge column so the
-- New Sale Order Summary can capture an editable Delivery / Packaging fee.
-- The charge is a non-taxable add-on already baked into the client-sent
-- grandTotal / total values, so no other column is affected. Default 0 keeps
-- existing rows behaving exactly as before.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "deliveryCharge" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "deliveryCharge" DECIMAL(65,30) NOT NULL DEFAULT 0;
