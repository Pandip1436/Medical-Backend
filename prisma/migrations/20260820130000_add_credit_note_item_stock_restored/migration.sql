-- Did approving this return actually put stock back? The inbound mirror of
-- InvoiceItem.stockApplied.
--
-- False when the approval skipped the restore: Stock Tracking was off (the sale
-- never took stock, so there is none to return), or the batch no longer existed
-- and the restore was logged-and-skipped.
--
-- Additive with DEFAULT true so existing approved returns backfill to the
-- common case. Without it the product timeline counts a non-restoring return as
-- stock coming back in, and then manufactures a negative "opening balance" row
-- to reconcile against the real current stock.
ALTER TABLE "CreditNoteItem"
  ADD COLUMN IF NOT EXISTS "stockRestored" BOOLEAN NOT NULL DEFAULT true;
