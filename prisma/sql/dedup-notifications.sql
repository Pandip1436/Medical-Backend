-- One-time cleanup: delete duplicate UNRESOLVED notifications that point at
-- the same entity (same invoiceId / productId / batchId / reminderId in the
-- message marker). Keeps the newest row per (type, marker); drops the older
-- siblings. Resolved/snoozed rows are left alone so audit history stays
-- intact.
--
-- Cause: pre-entityState legacy rows triggered shouldEscalate*(null, …) =>
-- true on every subsequent generator run, producing one extra row each time
-- until the user resolved them. The generator fix lives in
-- notifications.service.ts (shouldEscalateLowStock / shouldEscalatePaymentDue
-- now return false when prev is null). This script clears the existing dups
-- that were already written before that fix.
--
-- Safe to re-run: WHERE rn > 1 is a no-op once there are no duplicates.

DELETE FROM "Notification"
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY
          type,
          -- Extract the first [xxxId:yyy] marker from the message so the
          -- partition collapses all notifications about the same entity.
          (regexp_match(message, '\[(invoiceId|productId|batchId|reminderId):([^\]]+)\]'))[2]
        ORDER BY "createdAt" DESC
      ) AS rn
    FROM "Notification"
    WHERE
      "resolvedAt" IS NULL
      AND type IN ('PAYMENT_DUE', 'LOW_STOCK', 'EXPIRY', 'SYSTEM')
      AND message ~ '\[(invoiceId|productId|batchId|reminderId):[^\]]+\]'
  ) ranked
  WHERE rn > 1
);
