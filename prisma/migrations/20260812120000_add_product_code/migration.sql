-- The operator's own item code (MARG ItemCode, supplier SKU, hand-assigned).
-- Additive and nullable: every existing row stays valid with NULL.
--
-- Why it exists: product imports matched on `name` alone, and real catalogues
-- carry the same name twice under different codes (e.g. the same drug listed
-- under two company groupings). Matching those by name merged two distinct
-- products into one. The code gives re-imports a stable handle.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "productCode" TEXT;

-- Scoped per branch, mirroring the existing barcode constraint. Postgres
-- treats NULLs as distinct in a unique index, so the many un-coded rows do not
-- collide with each other — only two rows with the SAME non-null code in the
-- SAME branch are rejected.
CREATE UNIQUE INDEX IF NOT EXISTS "Product_productCode_branchId_key"
  ON "Product" ("productCode", "branchId");
