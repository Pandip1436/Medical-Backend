-- ─────────────────────────────────────────────────────────────
-- GRN edit support:
--   1. Batch.grnItemId — links a batch to the GRN line that received it,
--      so a GRN edit can find the exact batch it created (nullable; older
--      batches are backfilled by tuple match via the admin endpoint).
--   2. GrnEditLog — before/after audit trail of GRN edits.
-- Purely additive; no data loss.
-- ─────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "grnItemId" TEXT;

-- CreateTable
CREATE TABLE "GrnEditLog" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "editedByName" TEXT NOT NULL,
    "branchId" TEXT,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrnEditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrnEditLog_grnId_idx" ON "GrnEditLog"("grnId");

-- CreateIndex
CREATE INDEX "GrnEditLog_editedAt_idx" ON "GrnEditLog"("editedAt");

-- CreateIndex
CREATE INDEX "Batch_grnItemId_idx" ON "Batch"("grnItemId");

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_grnItemId_fkey" FOREIGN KEY ("grnItemId") REFERENCES "GRNItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnEditLog" ADD CONSTRAINT "GrnEditLog_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "GRN"("id") ON DELETE CASCADE ON UPDATE CASCADE;
