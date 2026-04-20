import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('--- DATABASE CHECK ---');
  
  const poCount = await prisma.purchaseOrder.count();
  console.log('Total Purchase Orders in DB:', poCount);
  
  if (poCount > 0) {
    const pos = await prisma.purchaseOrder.findMany({
      include: { items: true },
      take: 5
    });
    console.log('Sample Purchase Orders:', JSON.stringify(pos, null, 2));
  }

  const users = await prisma.user.findMany({
    select: { id: true, name: true, role: true, branchId: true }
  });
  console.log('User list:', JSON.stringify(users, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
