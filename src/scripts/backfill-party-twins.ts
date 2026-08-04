/**
 * One-time (idempotent) backfill: create the wholesale-customer ↔ supplier twin
 * links for all EXISTING rows.
 *
 * Order matters to avoid double-creating:
 *   1) every supplier without a customer twin  → ensureCustomerTwin
 *      (links a matching wholesale customer by GSTIN/phone, else creates one)
 *   2) every WHOLESALE customer still un-linked → ensureSupplierTwin
 *      (step 1 already linked the pairs that matched; this only fills the gaps)
 *
 * Re-runnable: a second pass finds everything already linked and no-ops.
 * Rows are processed individually (not one big transaction) so a single bad row
 * logs and is skipped instead of rolling back the whole backfill.
 *
 * Run:  npx ts-node -r tsconfig-paths/register src/scripts/backfill-party-twins.ts
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { PartyLinkService } from '../party-link/party-link.service';

async function run() {
  const log = new Logger('BackfillPartyTwins');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const link = app.get(PartyLinkService);

  let supplierLinked = 0;
  let supplierFailed = 0;
  const suppliers = await prisma.supplier.findMany({ where: { customerId: null }, select: { id: true } });
  log.log(`Step 1: ${suppliers.length} supplier(s) without a customer twin`);
  for (const s of suppliers) {
    try {
      const id = await link.ensureCustomerTwin(s.id);
      if (id) supplierLinked++;
    } catch (e) {
      supplierFailed++;
      log.error(`supplier ${s.id}: ${String(e)}`);
    }
  }

  let customerLinked = 0;
  let customerFailed = 0;
  const customers = await prisma.customer.findMany({
    where: { type: 'WHOLESALE', linkedSupplier: null },
    select: { id: true },
  });
  log.log(`Step 2: ${customers.length} wholesale customer(s) still without a supplier twin`);
  for (const c of customers) {
    try {
      const id = await link.ensureSupplierTwin(c.id);
      if (id) customerLinked++;
    } catch (e) {
      customerFailed++;
      log.error(`customer ${c.id}: ${String(e)}`);
    }
  }

  log.log(
    `Done. Suppliers → customer twins: ${supplierLinked} ok / ${supplierFailed} failed. ` +
      `Wholesale customers → supplier twins: ${customerLinked} ok / ${customerFailed} failed.`,
  );
  await app.close();
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
