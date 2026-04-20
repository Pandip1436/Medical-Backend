"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const count = await prisma.product.count({ where: { branchId: 'BRN-BR1' } });
    const orphaned = await prisma.product.count({ where: { branchId: null } });
    console.log('Final Verification:');
    console.log('- Products in Branch BR1:', count);
    console.log('- Orphaned Products (null):', orphaned);
}
main().catch(console.error).finally(() => prisma.$disconnect());
//# sourceMappingURL=final-verify.js.map