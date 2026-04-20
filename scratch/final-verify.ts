import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.product.count({ where: { branchId: 'BRN-BR1' } });
  const orphaned = await prisma.product.count({ where: { branchId: null } });
  console.log('Final Verification:');
  console.log('- Products in Branch BR1:', count);
  console.log('- Orphaned Products (null):', orphaned);
}
main().catch(console.error).finally(() => prisma.$disconnect());
