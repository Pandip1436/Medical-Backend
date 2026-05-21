-- Dry-run preview: how many rows would the dedup script delete, and what
-- do they look like? Read-only — safe to execute anytime.
SELECT
  type,
  COUNT(*) AS rows_to_delete
FROM (
  SELECT
    id,
    type,
    ROW_NUMBER() OVER (
      PARTITION BY
        type,
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
GROUP BY type
ORDER BY type;
