"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('--- SUPPLIERS DATA CHECK ---');
    const suppliers = await prisma.supplier.findMany({
        orderBy: { id: 'desc' },
        take: 10
    });
    console.log(JSON.stringify(suppliers, null, 2));
}
main().finally(() => prisma.$disconnect());
//# sourceMappingURL=check-suppliers-data.js.map