import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const branches = await prisma.branch.findMany();
  const products = await prisma.product.findMany({ select: { id: true, name: true, branchId: true } });
  console.log('Branches:', branches);
  console.log('Products:', products);
}
main().catch(console.error).finally(() => prisma.$disconnect());
