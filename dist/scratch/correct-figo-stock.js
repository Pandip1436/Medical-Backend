"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const apply = process.argv.includes('--apply');
const PRODUCT_ID = 'cmol4odgn0009xopddc4ha61f';
const FIXES = [
    { batchId: 'cmoletrpz0014jr27qnlw0frr', label: 'B-003', from: 40, to: 20 },
    { batchId: 'cmoskswsw000axrmh73xw0e4s', label: 'B-008', from: 60, to: 40 },
];
const PRODUCT_STOCK_FROM = 190;
const PRODUCT_STOCK_TO = 150;
async function main() {
    console.log(apply ? '⚠️  APPLY MODE\n' : '🔍 DRY RUN\n');
    const product = await prisma.product.findUnique({ where: { id: PRODUCT_ID } });
    if (!product) {
        console.log('Product not found.');
        return;
    }
    console.log(`Product: ${product.name}`);
    console.log(`  totalStock now    : ${product.totalStock}`);
    console.log(`  totalStock target : ${PRODUCT_STOCK_TO}`);
    if (product.totalStock !== PRODUCT_STOCK_FROM) {
        console.log(`\n⚠️  totalStock is ${product.totalStock}, expected ${PRODUCT_STOCK_FROM}. ` +
            `State has shifted since the last diagnostic. Aborting to avoid making it worse.`);
        return;
    }
    for (const f of FIXES) {
        const batch = await prisma.batch.findUnique({ where: { id: f.batchId } });
        if (!batch) {
            console.log(`\n⚠️  Batch ${f.label} not found. Aborting.`);
            return;
        }
        console.log(`Batch ${f.label}:  ${batch.quantity} → ${f.to}  (delta ${f.to - batch.quantity})`);
        if (batch.quantity !== f.from) {
            console.log(`\n⚠️  Batch ${f.label} qty is ${batch.quantity}, expected ${f.from}. ` +
                `State has shifted. Aborting.`);
            return;
        }
    }
    if (!apply) {
        console.log('\nRe-run with --apply to write the corrections.');
        return;
    }
    await prisma.$transaction(async (tx) => {
        for (const f of FIXES) {
            await tx.batch.update({ where: { id: f.batchId }, data: { quantity: f.to } });
            console.log(`   ✓ Batch ${f.label} set to ${f.to}`);
        }
        await tx.product.update({
            where: { id: PRODUCT_ID },
            data: { totalStock: PRODUCT_STOCK_TO },
        });
        console.log(`   ✓ Product.totalStock set to ${PRODUCT_STOCK_TO}`);
    });
    console.log('\nDone.');
}
main().catch(console.error).finally(() => prisma.$disconnect());
//# sourceMappingURL=correct-figo-stock.js.map