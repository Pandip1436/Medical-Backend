-- Credit Note pending-review lifecycle.
--
-- Adds a `status` field separating the inspection-review lifecycle from the
-- existing `settledAt` settlement timestamp. New CNs land in PENDING_REVIEW;
-- the side effects (stock restoration, customer-balance adjustment, invoice
-- status flip) only fire on approve(). Existing rows are backfilled to
-- APPROVED because they're already executed.

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "CreditNote"
  ADD COLUMN "status"       "CreditNoteStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt"   TIMESTAMP(3),
  ADD COLUMN "reviewNote"   TEXT;

-- AddForeignKey
ALTER TABLE "CreditNote"
  ADD CONSTRAINT "CreditNote_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing rows are already-executed credit notes, so they belong
-- in APPROVED. Set `reviewedAt` to `createdAt` so the audit trail isn't blank;
-- `reviewedById` stays null because we don't have a record of who approved them
-- (pre-feature). The `reviewNote` "Auto-migrated" marker makes this trivially
-- searchable later if anyone wants to clean up the historical rows.
UPDATE "CreditNote"
SET "status"     = 'APPROVED',
    "reviewedAt" = "createdAt",
    "reviewNote" = 'Auto-migrated — created before pending-review lifecycle existed'
WHERE "status" = 'PENDING_REVIEW';

-- Note: legacy SALES_RETURN ApprovalRequest rows (if any) are left in place.
-- They no longer get created by the new code path, and the executeApprovedAction
-- SALES_RETURN branch is retired with a defensive throw, so any operator who
-- approves a stale one will see a clear error pointing at the new endpoint.
