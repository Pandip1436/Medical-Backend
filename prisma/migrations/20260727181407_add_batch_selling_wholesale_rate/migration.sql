-- AlterTable
-- Per-batch selling & wholesale rates, mirroring the existing per-batch mrp /
-- purchaseRate. Default 0 = "not set" → billing falls back to the Product
-- master rate. IF NOT EXISTS keeps this safe on environments where the columns
-- may already have been added out-of-band via `prisma db push`.
ALTER TABLE "Batch" ADD COLUMN IF NOT EXISTS "sellingRate" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Batch" ADD COLUMN IF NOT EXISTS "wholesaleRate" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- Backfill existing batches from their product master so every current batch
-- carries an explicit sale price immediately (billing still falls back to the
-- master for any batch left at 0). Guarded on `= 0` so re-running is a no-op.
UPDATE "Batch" b
SET "sellingRate" = p."sellingRate"
FROM "Product" p
WHERE b."productId" = p."id" AND b."sellingRate" = 0;

UPDATE "Batch" b
SET "wholesaleRate" = p."wholesaleRate"
FROM "Product" p
WHERE b."productId" = p."id" AND b."wholesaleRate" = 0;
