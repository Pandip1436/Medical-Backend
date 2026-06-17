-- Per-line GST rate on GRN items. The purchase rate is GST-inclusive, so this
-- lets the Purchase Entry detail view / PDF extract the tax from within the line
-- value. Defaults to 0 for existing rows (which fall back to the legacy
-- totalAmount − lineValue derivation).
ALTER TABLE "GRNItem" ADD COLUMN IF NOT EXISTS "gstPercent" DECIMAL NOT NULL DEFAULT 0;
