-- Personal targeting for notifications. NULL = branch-wide (everyone in the
-- branch); a set value = only that user sees the row (e.g. approval results
-- like "Your credit bill request was approved" belong to the requester alone).
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "recipientId" TEXT;

CREATE INDEX IF NOT EXISTS "Notification_recipientId_idx" ON "Notification"("recipientId");
