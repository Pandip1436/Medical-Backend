-- Role targeting for notifications. NULL = no role restriction; 'ADMIN' = only
-- admins see the row. Used so approval REQUEST notifications ("X requested
-- approval for …") reach only approvers (admins), not every user in the branch.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "recipientRole" TEXT;

-- Backfill existing approval-request notifications so they immediately become
-- admin-only. Result notifications ("Request Approved/Rejected") keep NULL —
-- they're already personally targeted via recipientId.
UPDATE "Notification"
SET "recipientRole" = 'ADMIN'
WHERE "type" = 'APPROVAL'
  AND "title" = 'Approval Required'
  AND "recipientRole" IS NULL;
