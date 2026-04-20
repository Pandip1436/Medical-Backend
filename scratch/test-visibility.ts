import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testFindAllInclusive(branchId: string) {
  const where: any = { AND: [] };

  // Branch filter: include specific branch + global (null) items
  if (branchId && branchId !== 'all') {
    where.AND.push({
      OR: [{ branchId }, { branchId: null }],
    });
  }

  const results = await prisma.supplier.findMany({ where });
  console.log(`Results for branch ${branchId}:`, results.map(r => ({ id: r.id, name: r.name, branchId: r.branchId })));
}

async function main() {
  await testFindAllInclusive('BRN-HQ');
  await testFindAllInclusive('BRN-BR1');
}

main().finally(() => prisma.$disconnect());
