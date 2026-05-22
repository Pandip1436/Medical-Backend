// Smoke-test the two pending migrations actually landed and the columns
// match what the Prisma client expects. Reads one row of each model using
// the new columns; throws if Postgres still doesn't know about them.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const supplier = await prisma.supplier.findFirst({
    select: { id: true, whatsappOptIn: true, whatsappNumber: true },
  });
  console.log('Supplier sample:', supplier ?? '(none)');

  const product = await prisma.product.findFirst({
    select: { id: true, name: true, preferredSupplierId: true },
  });
  console.log('Product sample:', product ?? '(none)');

  console.log('\n✓ Both new columns are queryable.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
