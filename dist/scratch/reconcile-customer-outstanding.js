"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const apply = process.argv.includes('--apply');
async function main() {
    console.log(apply ? '⚠️  APPLY MODE\n' : '🔍 DRY RUN\n');
    const customers = await prisma.customer.findMany({
        select: { id: true, name: true, currentOutstanding: true },
    });
    let mismatches = 0;
    let fixed = 0;
    for (const c of customers) {
        const invoices = await prisma.invoice.findMany({
            where: {
                customerId: c.id,
                status: { in: ['CREDIT', 'PARTIAL'] },
            },
            select: { grandTotal: true, amountPaid: true },
        });
        const expected = invoices.reduce((s, i) => s + (Number(i.grandTotal) - Number(i.amountPaid)), 0);
        const stored = Number(c.currentOutstanding);
        const diff = +(expected - stored).toFixed(2);
        if (Math.abs(diff) < 0.01)
            continue;
        mismatches++;
        console.log(`  ${c.name.padEnd(30)}  stored=${stored.toFixed(2).padStart(10)}  expected=${expected.toFixed(2).padStart(10)}  diff=${diff > 0 ? '+' : ''}${diff.toFixed(2)}`);
        if (apply) {
            await prisma.customer.update({
                where: { id: c.id },
                data: { currentOutstanding: expected },
            });
            fixed++;
        }
    }
    console.log(`\n${mismatches} customer(s) had drift.${apply ? ` Fixed ${fixed}.` : ' Re-run with --apply to write.'}`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=reconcile-customer-outstanding.js.map