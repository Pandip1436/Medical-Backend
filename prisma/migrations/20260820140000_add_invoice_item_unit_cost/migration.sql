-- Unit purchase cost snapshot on each invoice line, for COGS.
--
-- Why a snapshot and not a lookup: both live cost sources move. A GRN with a
-- newer delivery date overwrites Product.purchaseRate (GrnService), so costing
-- an old sale from the master silently re-prices closed periods — re-running
-- March's P&L after an April purchase would report a different March profit.
-- Freezing the cost on the line makes financial reports reproducible, and makes
-- a sales return reverse exactly the cost its sale charged even when the return
-- falls in a later month than the sale.
--
-- Additive with DEFAULT 0, where 0 means "not snapshotted". Rows written before
-- this column keep 0 and readers fall back to batch → product master for them,
-- so no backfill is needed and no existing row changes value.
ALTER TABLE "InvoiceItem"
  ADD COLUMN IF NOT EXISTS "unitCost" DECIMAL(65,30) NOT NULL DEFAULT 0;
