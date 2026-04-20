"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function testFindAllInclusive(branchId) {
    const where = { AND: [] };
    if (branchId && branchId !== 'all') {
        where.AND.push({
            OR: [{ branchId }, { branchId: null }],
        });
    }
    const results = await prisma.supplier.findMany({ where });
    console.log(`Results for branch ${branchId}:`, results.map(r => ({ id: r.id, name: r.name, branchId: r.branchId })));
}
async function main() {
    await testFindAllInclusive('BRN-HQ');
    await testFindAllInclusive('BRN-BR1');
}
main().finally(() => prisma.$disconnect());
//# sourceMappingURL=test-visibility.js.map