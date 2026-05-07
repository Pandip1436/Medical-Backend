/**
 * Where does the 40 (now 60 after fix) "extra stock" come from?
 * Checks every possible source.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const productId = process.argv[2] ?? 'cmol4odgn0009xopddc4ha61f';

async function main() {
  const p = await prisma.product.findUnique({ where: { id: productId } });
  if (!p) { console.log('Product not found'); return; }

  console.log(`\n📦 ${p.name}  (id=${p.id})\n`);
  console.log(`Product.totalStock = ${p.totalStock}`);
  console.log(`Product.createdAt  = ${p.createdAt.toISOString()}\n`);

  // 1. Sum of every GRN line item ever created for this product
  const grnItems = await prisma.gRNItem.findMany({
    where: { productId },
    include: { grn: { select: { grnNumber: true, date: true, isReplacement: true, branchId: true } } },
    orderBy: { grn: { date: 'asc' } },
  });
  console.log(`── GRN items (${grnItems.length}) ──`);
  let grnSum = 0;
  for (const gi of grnItems) {
    const add = gi.receivedQty + gi.freeQty;
    grnSum += add;
    console.log(`  ${gi.grn.date.toISOString().slice(0,10)}  ${gi.grn.grnNumber.padEnd(30)}  +${add.toString().padStart(3)}  (rec ${gi.receivedQty}, free ${gi.freeQty}, ord ${gi.orderedQty}, dmg ${gi.damageQty})  branch=${gi.grn.branchId ?? '-'}  isRepl=${gi.grn.isReplacement}`);
  }
  console.log(`  Σ +${grnSum}\n`);

  // 2. Sum of every Purchase Return item ever
  const prItems = await prisma.purchaseReturnItem.findMany({
    where: { productId },
    include: { purchaseReturn: { select: { debitNoteNo: true, reason: true, date: true } } },
    orderBy: { purchaseReturn: { date: 'asc' } },
  });
  console.log(`── Purchase Return items (${prItems.length}) ──`);
  let prSum = 0;
  for (const it of prItems) {
    prSum += it.returnedQty;
    console.log(`  ${it.purchaseReturn.date.toISOString().slice(0,10)}  ${it.purchaseReturn.debitNoteNo.padEnd(30)}  -${it.returnedQty.toString().padStart(3)}  reason="${it.purchaseReturn.reason}"`);
  }
  console.log(`  Σ -${prSum}\n`);

  // 3. Stock adjustment log
  const adjusts = await prisma.stockAdjustmentLog.findMany({
    where: { productId },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`── Stock adjustment log (${adjusts.length}) ──`);
  let adjSum = 0;
  for (const a of adjusts) {
    adjSum += a.diff;
    console.log(`  ${a.createdAt.toISOString().slice(0,10)}  diff=${a.diff > 0 ? '+' : ''}${a.diff}  prev=${a.previousQty} adj=${a.adjustedQty}  by ${a.userName}  reason="${a.reason}"`);
  }
  console.log(`  Σ ${adjSum >= 0 ? '+' : ''}${adjSum}\n`);

  // 4. Sum of batch quantities right now
  const batches = await prisma.batch.findMany({ where: { productId }, orderBy: { createdAt: 'asc' } });
  console.log(`── Current batches (${batches.length}) ──`);
  let batchSum = 0;
  for (const b of batches) {
    batchSum += b.quantity;
    console.log(`  batch ${b.batchNumber.padEnd(15)} qty=${b.quantity.toString().padStart(4)}  created ${b.createdAt.toISOString().slice(0,10)}  id=${b.id}`);
  }
  console.log(`  Σ batch quantities = ${batchSum}\n`);

  // 5. Sales (Invoice items) — could also reduce stock
  const invItems = await prisma.invoiceItem.findMany({
    where: { productId },
    include: { invoice: { select: { invoiceNumber: true, date: true, status: true } } },
    orderBy: { invoice: { date: 'asc' } },
  });
  console.log(`── Sales / Invoice items (${invItems.length}) ──`);
  let salesSum = 0;
  for (const ii of invItems) {
    salesSum += ii.quantity;
    console.log(`  ${ii.invoice.date.toISOString().slice(0,10)}  ${ii.invoice.invoiceNumber.padEnd(20)}  -${ii.quantity}  status=${ii.invoice.status}`);
  }
  console.log(`  Σ sales -${salesSum}\n`);

  // 6. Credit notes (sales returns) — add back
  const cnItems = await prisma.creditNoteItem.findMany({
    where: { productId },
    include: { creditNote: { select: { creditNoteNo: true, date: true } } },
    orderBy: { creditNote: { date: 'asc' } },
  });
  console.log(`── Credit Note items / sales returns (${cnItems.length}) ──`);
  let cnSum = 0;
  for (const ci of cnItems) {
    cnSum += ci.returnedQty;
    console.log(`  ${ci.creditNote.date.toISOString().slice(0,10)}  ${ci.creditNote.creditNoteNo.padEnd(20)}  +${ci.returnedQty}`);
  }
  console.log(`  Σ credit-note +${cnSum}\n`);

  // 7. Final reconciliation
  const expected = grnSum - prSum + adjSum - salesSum + cnSum;
  console.log(`──────────────────────────────────────────────────────────`);
  console.log(`Expected from all known sources = +${grnSum} -${prSum} ${adjSum >= 0 ? '+' : ''}${adjSum} -${salesSum} +${cnSum} = ${expected}`);
  console.log(`Product.totalStock              = ${p.totalStock}`);
  console.log(`Sum of batch quantities         = ${batchSum}`);
  console.log(`Discrepancy (totalStock - expected) = ${p.totalStock - expected}`);
  console.log(`Discrepancy (totalStock - batchSum) = ${p.totalStock - batchSum}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
