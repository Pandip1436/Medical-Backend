import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('--- SUPPLIERS DATA CHECK ---');
  const suppliers = await prisma.supplier.findMany({
    orderBy: { id: 'desc' }, // assuming cuid or similar
    take: 10
  });
  console.log(JSON.stringify(suppliers, null, 2));
}

main().finally(() => prisma.$disconnect());
