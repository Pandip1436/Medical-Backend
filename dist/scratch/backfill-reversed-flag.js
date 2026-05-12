"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const apply = process.argv.includes('--apply');
const DN_IDS_ALREADY_REVERSED = [
    'DN-1777982493121-319',
    'DN-1777550904583-383',
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
        }
        else {
            console.log(`→ ${t.debitNoteNo} will be flagged. reason="${t.reason}"`);
        }
    }
    if (!apply) {
        console.log('\nRe-run with --apply to write.');
        return;
    }
    const now = new Date();
    for (const t of targets) {
        if (t.stockReversedAt)
            continue;
        await prisma.purchaseReturn.update({
            where: { id: t.id },
            data: { stockReversedAt: now },
        });
        console.log(`   ✓ flagged ${t.debitNoteNo}`);
    }
    console.log('\nDone.');
}
main().catch(console.error).finally(() => prisma.$disconnect());
//# sourceMappingURL=backfill-reversed-flag.js.map