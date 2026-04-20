"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() { const count = await prisma.purchaseReturnItem.count(); console.log('Items Count:', count); const prs = await prisma.purchaseReturn.findMany({ include: { items: true }, take: 2, orderBy: { date: 'desc' } }); console.log(JSON.stringify(prs, null, 2)); }
main().finally(() => prisma.$disconnect());
//# sourceMappingURL=test-db.js.map