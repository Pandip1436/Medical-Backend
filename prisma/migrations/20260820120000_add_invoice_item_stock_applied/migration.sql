-- Does this invoice line actually represent inventory that moved?
--
-- Additive with DEFAULT true, so every existing row backfills to the correct
-- value in place: all of them were written by stock-moving paths (billing's
-- deductStockForItem, or the invoice importer, which decrements totalStock).
--
-- Only lines billed while the new Stock Tracking switch is OFF get `false` —
-- those never resolve a batch and never touch totalStock.
--
-- Why not just test `batchId = ''`: an imported invoice line can legitimately
-- carry an empty batchId (the importer couldn't resolve which batch it drew
-- from) while still having decremented stock. Using batchId as the signal would
-- wrongly drop those rows out of the product timeline's running-stock column
-- and resurrect a phantom "opening balance" row to reconcile the difference.
ALTER TABLE "InvoiceItem"
  ADD COLUMN IF NOT EXISTS "stockApplied" BOOLEAN NOT NULL DEFAULT true;
