"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const targetBranch = 'BRN-BR1';
    const products = await prisma.product.updateMany({
        where: { branchId: null },
        data: { branchId: targetBranch }
    });
    const suppliers = await prisma.supplier.updateMany({
        where: { branchId: null },
        data: { branchId: targetBranch }
    });
    console.log(`Rescued ${products.count} products and ${suppliers.count} suppliers to branch ${targetBranch}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
//# sourceMappingURL=resue-data.js.map