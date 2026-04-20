import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const targetBranch = 'BRN-BR1'; // Move rescued items here
  
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
