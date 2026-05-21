// One-time dedup of duplicate UNRESOLVED notifications produced by the
// pre-fix shouldEscalate*(null, ...) bug. Reports counts before + after so
// the operator can see exactly what was removed.
//
// Run:  npx tsx scripts/dedup-notifications.ts
// Safe to re-run; once the duplicates are gone, the WHERE rn > 1 set is empty.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // ── Step 1: preview ────────────────────────────────────────────────
  const preview = await prisma.$queryRawUnsafe<
    Array<{ type: string; rows_to_delete: bigint }>
  >(`
    SELECT type, COUNT(*)::bigint AS rows_to_delete
    FROM (
      SELECT
        id,
        type,
        ROW_NUMBER() OVER (
          PARTITION BY
            type,
            (regexp_match(message, '\\[(invoiceId|productId|batchId|reminderId):([^\\]]+)\\]'))[2]
          ORDER BY "createdAt" DESC
        ) AS rn
      FROM "Notification"
      WHERE
        "resolvedAt" IS NULL
        AND type IN ('PAYMENT_DUE', 'LOW_STOCK', 'EXPIRY', 'SYSTEM')
        AND message ~ '\\[(invoiceId|productId|batchId|reminderId):[^\\]]+\\]'
    ) ranked
    WHERE rn > 1
    GROUP BY type
    ORDER BY type;
  `);

  const totalToDelete = preview.reduce(
    (sum, row) => sum + Number(row.rows_to_delete),
    0,
  );

  console.log('\n── Dedup preview ──────────────────────────────');
  if (preview.length === 0) {
    console.log('No duplicates found. Nothing to delete.');
    return;
  }
  for (const row of preview) {
    console.log(
      `  ${row.type.padEnd(14)}  ${row.rows_to_delete} row(s) to delete`,
    );
  }
  console.log(`  ${'TOTAL'.padEnd(14)}  ${totalToDelete} row(s)`);

  // ── Step 2: show a sample of what would be kept vs deleted ─────────
  // For each (type, marker) with duplicates, show the kept (newest) and the
  // dropped (older siblings). Helps the operator sanity-check.
  const sample = await prisma.$queryRawUnsafe<
    Array<{
      type: string;
      marker: string;
      id: string;
      createdAt: Date;
      message: string;
      rn: bigint;
      verdict: string;
    }>
  >(`
    SELECT type, marker, id, "createdAt", message, rn,
           CASE WHEN rn = 1 THEN 'KEEP' ELSE 'DELETE' END AS verdict
    FROM (
      SELECT
        id, type, message, "createdAt",
        (regexp_match(message, '\\[(invoiceId|productId|batchId|reminderId):([^\\]]+)\\]'))[2] AS marker,
        ROW_NUMBER() OVER (
          PARTITION BY
            type,
            (regexp_match(message, '\\[(invoiceId|productId|batchId|reminderId):([^\\]]+)\\]'))[2]
          ORDER BY "createdAt" DESC
        ) AS rn,
        COUNT(*) OVER (
          PARTITION BY
            type,
            (regexp_match(message, '\\[(invoiceId|productId|batchId|reminderId):([^\\]]+)\\]'))[2]
        ) AS group_size
      FROM "Notification"
      WHERE
        "resolvedAt" IS NULL
        AND type IN ('PAYMENT_DUE', 'LOW_STOCK', 'EXPIRY', 'SYSTEM')
        AND message ~ '\\[(invoiceId|productId|batchId|reminderId):[^\\]]+\\]'
    ) ranked
    WHERE group_size > 1
    ORDER BY type, marker, rn
    LIMIT 12;
  `);

  console.log('\n── Sample (first 12 rows of duplicated groups) ──');
  for (const row of sample) {
    const stamp = row.createdAt.toISOString().slice(0, 19).replace('T', ' ');
    const msgPreview =
      row.message.length > 70 ? row.message.slice(0, 67) + '…' : row.message;
    console.log(
      `  ${row.verdict.padEnd(7)} ${row.type.padEnd(12)} ${stamp}  ${msgPreview}`,
    );
  }

  // ── Step 3: delete ─────────────────────────────────────────────────
  console.log('\n── Deleting duplicates… ───────────────────────');
  const deleted = await prisma.$executeRawUnsafe(`
    DELETE FROM "Notification"
    WHERE id IN (
      SELECT id FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY
              type,
              (regexp_match(message, '\\[(invoiceId|productId|batchId|reminderId):([^\\]]+)\\]'))[2]
            ORDER BY "createdAt" DESC
          ) AS rn
        FROM "Notification"
        WHERE
          "resolvedAt" IS NULL
          AND type IN ('PAYMENT_DUE', 'LOW_STOCK', 'EXPIRY', 'SYSTEM')
          AND message ~ '\\[(invoiceId|productId|batchId|reminderId):[^\\]]+\\]'
      ) ranked
      WHERE rn > 1
    );
  `);
  console.log(`  Deleted ${deleted} row(s).`);

  // ── Step 4: verify ─────────────────────────────────────────────────
  const after = await prisma.$queryRawUnsafe<Array<{ rows_to_delete: bigint }>>(`
    SELECT COUNT(*)::bigint AS rows_to_delete
    FROM (
      SELECT
        ROW_NUMBER() OVER (
          PARTITION BY
            type,
            (regexp_match(message, '\\[(invoiceId|productId|batchId|reminderId):([^\\]]+)\\]'))[2]
          ORDER BY "createdAt" DESC
        ) AS rn
      FROM "Notification"
      WHERE
        "resolvedAt" IS NULL
        AND type IN ('PAYMENT_DUE', 'LOW_STOCK', 'EXPIRY', 'SYSTEM')
        AND message ~ '\\[(invoiceId|productId|batchId|reminderId):[^\\]]+\\]'
    ) ranked
    WHERE rn > 1;
  `);
  console.log(
    `\n── Verify ─────────────────────────────────────`,
  );
  console.log(`  Remaining duplicates: ${after[0].rows_to_delete}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
