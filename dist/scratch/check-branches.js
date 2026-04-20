"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    const branches = await prisma.branch.findMany();
    console.log('Branches:', JSON.stringify(branches, null, 2));
}
main().finally(() => prisma.$disconnect());
//# sourceMappingURL=check-branches.js.map