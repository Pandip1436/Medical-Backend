/**
 * Diagnose stock vs purchase math for any product.
 *
 *   npx ts-node scratch/diagnose-stock.ts                   # read-only report
 *   npx ts-node scratch/diagnose-stock.ts <productId>       # focus on one product
 *   npx ts-node scratch/diagnose-stock.ts --apply           # actually re-add wrongly-deducted stock
 *   npx ts-node scratch/diagnose-stock.ts <productId> --apply
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const productId = args.find((a) => !a.startsWith('--'));

const SHORT_RE = /short.*delivery|short.*supply/i;

function fmtQty(n: number) {
  return n > 0 ? `+${n}` : `${n}`;
}

async function main() {
  console.log(apply ? '⚠️  APPLY MODE — changes will be written\n' : '🔍 DRY RUN — no changes\n');

  // 1. Resolve the product(s) to inspect
  const products = productId
    ? await prisma.product.findMany({ where: { id: productId } })
    : await prisma.product.findMany({ where: { isActive: true } });

  if (products.length === 0) {
    console.log('No products matched.');
    return;
  }

  let anyMismatch = false;

  for (const p of products) {
    // 2. Sum all GRN line items for this product (across every GRN)
    const grnItems = await prisma.gRNItem.findMany({
      where: { productId: p.id },
      include: { grn: { select: { isReplacement: true, grnNumber: true, date: true } } },
    });
    const totalReceived = grnItems.reduce((s, g) => s + g.receivedQty + g.freeQty, 0);

    // 3. Sum all PurchaseReturn line items, classifying by reason
    const prItems = await prisma.purchaseReturnItem.findMany({
      where: { productId: p.id },
      include: { purchaseReturn: { select: { reason: true, debitNoteNo: true, date: true } } },
    });
    let returnedShort = 0;   // wrongly deducted stock (goods never arrived)
    let returnedReal = 0;    // correctly deducted (damaged, expired, wrong, etc.)
    const shortRows: Array<{ dn: string; qty: number; batchId: string }> = [];
    for (const it of prItems) {
      const reason = it.purchaseReturn.reason ?? '';
      if (SHORT_RE.test(reason)) {
        returnedShort += it.returnedQty;
        shortRows.push({ dn: it.purchaseReturn.debitNoteNo, qty: it.returnedQty, batchId: it.batchId });
      } else {
        returnedReal += it.returnedQty;
      }
    }

    // 4. Compute expected stock from movements alone
    const expectedFromMovements = totalReceived - returnedReal;
    const actual = p.totalStock;
    const baseline = actual - expectedFromMovements + returnedShort; // unaccounted (initial / adjustments)

    const stockBugDelta = returnedShort; // amount currently missing because of short-delivery DN bug
    const corrected = actual + stockBugDelta;

    if (totalReceived === 0 && returnedShort === 0 && returnedReal === 0) {
      // boring product, skip
      continue;
    }

    if (stockBugDelta > 0 || baseline !== 0) anyMismatch = true;

    console.log(`──────────────────────────────────────────────────────────────────────`);
    console.log(`📦 ${p.name}  (id=${p.id})`);
    console.log(`   GRN received total    : ${fmtQty(totalReceived)}`);
    console.log(`   PR returned (real)    : ${fmtQty(-returnedReal)}    (damage / expiry / wrong / etc.)`);
    console.log(`   PR returned (short)   : ${fmtQty(-returnedShort)}    ❌ should not have touched stock`);
    console.log(`   Expected from movmnts : ${fmtQty(expectedFromMovements)}`);
    console.log(`   Current totalStock    : ${fmtQty(actual)}`);
    console.log(`   Baseline / opening    : ${fmtQty(baseline)}    (initial value or pre-history adjustments)`);
    if (stockBugDelta > 0) {
      console.log(`   🔧 After fix expected : ${fmtQty(corrected)}    (+${stockBugDelta} re-added)`);
      for (const r of shortRows) {
        console.log(`      will re-add ${r.qty} via ${r.dn} → batchId ${r.batchId}`);
      }
    }
  }

  if (!apply) {
    console.log(`\nRun again with --apply to re-add the wrongly-deducted stock.`);
    return;
  }

  // ─── APPLY ────────────────────────────────────────────────────────────────
  if (!anyMismatch) {
    console.log(`\nNothing to fix.`);
    return;
  }

  console.log(`\nApplying corrections…`);

  // Re-walk just the short-delivery items and increment batch + product
  const shortPRItems = await prisma.purchaseReturnItem.findMany({
    where: {
      ...(productId ? { productId } : {}),
      purchaseReturn: { reason: { contains: 'short', mode: 'insensitive' } },
    },
    include: { purchaseReturn: { select: { debitNoteNo: true, reason: true } } },
  });

  let fixed = 0;
  for (const it of shortPRItems) {
    if (!SHORT_RE.test(it.purchaseReturn.reason ?? '')) continue; // belt + suspenders
    await prisma.batch.update({
      where: { id: it.batchId },
      data: { quantity: { increment: it.returnedQty } },
    }).catch(() => {});
    await prisma.product.update({
      where: { id: it.productId },
      data: { totalStock: { increment: it.returnedQty } },
    });
    console.log(`   ✓ ${it.purchaseReturn.debitNoteNo}: re-added ${it.returnedQty} to ${it.productName} (batch ${it.batchNumber})`);
    fixed++;
  }
  console.log(`\nDone — fixed ${fixed} line item(s).`);
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
