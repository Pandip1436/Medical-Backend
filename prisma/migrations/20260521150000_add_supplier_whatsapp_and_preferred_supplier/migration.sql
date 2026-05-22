-- Phase 5 of the WhatsApp pipeline: extend to low-stock supplier alerts.
--
-- 1. Supplier WhatsApp consent — mirror what Customer already has (opt-in
--    boolean + optional alternate WhatsApp number). Existing rows default to
--    opt-in=true so the feature works out of the box once flagged on; admin
--    can opt suppliers out individually from the SupplierFormDialog later.
-- 2. Product.preferredSupplierId — optional override for which supplier to
--    notify on low-stock. When null the listener falls back to the most
--    recent Batch.supplierId for that product. FK is nullable + ON DELETE
--    SET NULL so deleting a supplier doesn't cascade-delete products.
-- 3. WhatsAppMessage.templateVars — serialized template input vars (Json)
--    so the retry sweeper can rebuild the Meta template payload for
--    non-invoice senders without re-firing the source event (which would
--    risk duplicating the underlying Notification row).

-- ── #1: Supplier opt-in + alternate WhatsApp number ──────────────────────
ALTER TABLE "Supplier"
  ADD COLUMN IF NOT EXISTS "whatsappOptIn"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "whatsappNumber" TEXT;

-- ── #2: Product.preferredSupplierId (nullable FK) ────────────────────────
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "preferredSupplierId" TEXT;

-- Add the FK constraint only if it doesn't already exist (idempotent re-run).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Product_preferredSupplierId_fkey'
  ) THEN
    ALTER TABLE "Product"
      ADD CONSTRAINT "Product_preferredSupplierId_fkey"
      FOREIGN KEY ("preferredSupplierId")
      REFERENCES "Supplier"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;

-- Index the FK column so listener lookups stay fast even at scale.
CREATE INDEX IF NOT EXISTS "Product_preferredSupplierId_idx"
  ON "Product"("preferredSupplierId");

-- ── #3: WhatsAppMessage.templateVars (Json, nullable) ────────────────────
ALTER TABLE "WhatsAppMessage"
  ADD COLUMN IF NOT EXISTS "templateVars" JSONB;
