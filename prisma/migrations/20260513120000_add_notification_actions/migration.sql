-- Notification gains lifecycle / audit / state-snapshot columns used by the
-- inbox UX (Layer 1 + Layer 2 dedup) introduced on 13-May-2026:
--   • snoozedUntil  — defer surfacing this alert until a future timestamp
--   • resolvedAt    — stamped when the user acts on the alert (audit trail)
--   • resolvedById  — user id who resolved it
--   • entityState   — JSON snapshot of the underlying entity at create-time;
--                     consulted by the scheduler to only re-fire when the
--                     situation has worsened (Layer 2 escalation)
--
-- Plus a composite index used by findAll() for the active-alert filter.
--
-- IF NOT EXISTS makes this safe in dev environments where the columns were
-- already added out-of-band via `prisma db push`.

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "snoozedUntil" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "resolvedAt"   TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "resolvedById" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "entityState"  JSONB;

CREATE INDEX IF NOT EXISTS "Notification_branchId_isRead_snoozedUntil_idx"
  ON "Notification" ("branchId", "isRead", "snoozedUntil");
