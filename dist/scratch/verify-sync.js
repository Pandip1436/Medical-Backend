"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const branches = await prisma.branch.findMany();
    const products = await prisma.product.findMany({ select: { id: true, name: true, branchId: true } });
    console.log('Branches:', branches);
    console.log('Products:', products);
}
main().catch(console.error).finally(() => prisma.$disconnect());
//# sourceMappingURL=verify-sync.js.map