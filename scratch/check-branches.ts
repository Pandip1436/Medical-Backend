import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const branches = await prisma.branch.findMany();
  console.log('Branches:', JSON.stringify(branches, null, 2));
}

main().finally(() => prisma.$disconnect());
