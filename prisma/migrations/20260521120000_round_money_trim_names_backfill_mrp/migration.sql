-- Playtest cleanup migration.
--
-- 1. Bug #1 — Round historic float-noise on every Decimal money/tax column of
--    Invoice and InvoiceItem to 2dp. Going forward BillingService writes these
--    pre-rounded; this pass scrubs the existing 5.399999999999999 / etc.
-- 2. Bug #7 — Trim whitespace from Customer.name and the Invoice.customerName
--    denormalised copy. Same root cause as the Branch.name leading-space fix
--    in Phase 0 — text fields not trimmed at the boundary.
-- 3. Bug #8 — Backfill InvoiceItem.mrp on rows that currently read 0 by
--    preferring the matching Batch.mrp (the strip-time price) and falling back
--    to the Product.mrp master.

-- ── #1: round all Decimal money/tax columns on Invoice ────────────────────
UPDATE "Invoice"
SET
  "subtotal"        = ROUND("subtotal"::numeric,        2),
  "productDiscount" = ROUND("productDiscount"::numeric, 2),
  "taxableAmount"   = ROUND("taxableAmount"::numeric,   2),
  "cgst"            = ROUND("cgst"::numeric,            2),
  "sgst"            = ROUND("sgst"::numeric,            2),
  "igst"            = ROUND("igst"::numeric,            2),
  "deliveryCharge"  = ROUND("deliveryCharge"::numeric,  2),
  "roundOff"        = ROUND("roundOff"::numeric,        2),
  "grandTotal"      = ROUND("grandTotal"::numeric,      2),
  "amountPaid"      = ROUND("amountPaid"::numeric,      2),
  "changeReturned"  = ROUND("changeReturned"::numeric,  2);

-- ── #1 (cont'd): same scrub for InvoiceItem rate/amount/mrp/discount/gst ──
UPDATE "InvoiceItem"
SET
  "mrp"             = ROUND("mrp"::numeric,             2),
  "rate"            = ROUND("rate"::numeric,            2),
  "discountPercent" = ROUND("discountPercent"::numeric, 2),
  "gstPercent"      = ROUND("gstPercent"::numeric,      2),
  "amount"          = ROUND("amount"::numeric,          2);

-- Also normalise QuotationItem so quotation totals stay clean once they're
-- ever re-saved or recomputed via a regression test.
UPDATE "QuotationItem"
SET
  "mrp"             = ROUND("mrp"::numeric,             2),
  "rate"            = ROUND("rate"::numeric,            2),
  "discountPercent" = ROUND("discountPercent"::numeric, 2),
  "gstPercent"      = ROUND("gstPercent"::numeric,      2),
  "amount"          = ROUND("amount"::numeric,          2);

UPDATE "Quotation"
SET
  "subtotal"       = ROUND("subtotal"::numeric,       2),
  "cgst"           = ROUND("cgst"::numeric,           2),
  "sgst"           = ROUND("sgst"::numeric,           2),
  "deliveryCharge" = ROUND("deliveryCharge"::numeric, 2),
  "total"          = ROUND("total"::numeric,          2);

-- ── #7: trim whitespace on customer-name fields ──────────────────────────
UPDATE "Customer"
SET "name" = TRIM("name")
WHERE "name" <> TRIM("name");

UPDATE "Invoice"
SET "customerName" = TRIM("customerName")
WHERE "customerName" <> TRIM("customerName");

UPDATE "Quotation"
SET "customerName" = TRIM("customerName")
WHERE "customerName" <> TRIM("customerName");

UPDATE "CreditNote"
SET "customerName" = TRIM("customerName")
WHERE "customerName" <> TRIM("customerName");

-- ── #8: backfill InvoiceItem.mrp where it's 0 ────────────────────────────
-- Prefer the chosen Batch.mrp (that's what was on the strip at sale time).
UPDATE "InvoiceItem" ii
SET "mrp" = ROUND(b."mrp"::numeric, 2)
FROM "Batch" b
WHERE ii."batchId" = b."id"
  AND ii."mrp" = 0
  AND b."mrp" > 0;

-- Fall back to the Product master for any line whose batch has no mrp on
-- file (or whose batch row was deleted/archived).
UPDATE "InvoiceItem" ii
SET "mrp" = ROUND(p."mrp"::numeric, 2)
FROM "Product" p
WHERE ii."productId" = p."id"
  AND ii."mrp" = 0
  AND p."mrp" > 0;
