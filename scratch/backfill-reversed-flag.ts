/**
 * Backfill the new stockReversedAt flag on PurchaseReturn rows whose
 * stock was already reversed by the (non-idempotent) old endpoint or the
 * one-off scripts run today.
 *
 *   npx ts-node scratch/backfill-reversed-flag.ts          # dry run
 *   npx ts-node scratch/backfill-reversed-flag.ts --apply  # write
 *
 * Heuristic: if a short-delivery DN exists and the affected batch+product
 * stock is consistent with the qty NOT having been deducted, mark it as
 * already-reversed. After today's manual correction for Figo-335mj, both
 * its short-delivery DNs are in this state.
 *
 * In practice we've only ever touched Figo-335mj — so we mark both of its
 * short-delivery DNs as reversed and leave everyone else alone.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

const DN_IDS_ALREADY_REVERSED = [
  'DN-1777982493121-319', // Figo-335mj short-delivery (5/5)
  'DN-1777550904583-383', // Figo-335mj short-delivery (30/4)
];

async function main() {
  console.log(apply ? '⚠️  APPLY MODE\n' : '🔍 DRY RUN\n');

  const targets = await prisma.purchaseReturn.findMany({
    where: { debitNoteNo: { in: DN_IDS_ALREADY_REVERSED } },
    select: { id: true, debitNoteNo: true, reason: true, stockReversedAt: true },
  });

  if (targets.length === 0) {
    console.log('No matching debit notes found.');
    return;
  }

  for (const t of targets) {
    if (t.stockReversedAt) {
      console.log(`✓ ${t.debitNoteNo} already flagged (stockReversedAt=${t.stockReversedAt.toISOString()})`);
    } else {
      console.log(`→ ${t.debitNoteNo} will be flagged. reason="${t.reason}"`);
    }
  }

  if (!apply) {
    console.log('\nRe-run with --apply to write.');
    return;
  }

  const now = new Date();
  for (const t of targets) {
    if (t.stockReversedAt) continue;
    await prisma.purchaseReturn.update({
      where: { id: t.id },
      data: { stockReversedAt: now },
    });
    console.log(`   ✓ flagged ${t.debitNoteNo}`);
  }
  console.log('\nDone.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
