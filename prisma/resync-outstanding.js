/**
 * One-off resync for `Customer.currentOutstanding`.
 *
 * The cached column is incrementally maintained by the billing/payment/credit
 * paths, but older data drifted when invoices were CANCELLED without the cache
 * being decremented (fixed going forward in BillingService.update). This
 * recomputes the column from the source of truth so the value matches the live
 * outstanding everywhere (detail header, list column, has-outstanding filter,
 * delete guard, ledger/aged-receivables reports).
 *
 * Outstanding = Σ (grandTotal - amountPaid) over UNPAID/PARTIAL invoices,
 * clamped at 0. DRAFT, CANCELLED, PAID, RETURNED contribute nothing.
 *
 * Idempotent — safe to re-run. Run with:  node prisma/resync-outstanding.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "Customer" c
    SET "currentOutstanding" = COALESCE(sub.due, 0)
    FROM (
      SELECT i."customerId" AS cid,
             SUM(GREATEST(i."grandTotal" - i."amountPaid", 0)) AS due
      FROM "Invoice" i
      WHERE i.status IN ('UNPAID', 'PARTIAL')
      GROUP BY i."customerId"
    ) sub
    WHERE c.id = sub.cid
      AND c."currentOutstanding" IS DISTINCT FROM COALESCE(sub.due, 0)
  `);

  // Customers with no open invoices at all must be zeroed too (the join above
  // only touches customers that appear in the invoice subquery).
  const zeroed = await prisma.$executeRawUnsafe(`
    UPDATE "Customer" c
    SET "currentOutstanding" = 0
    WHERE c."currentOutstanding" <> 0
      AND NOT EXISTS (
        SELECT 1 FROM "Invoice" i
        WHERE i."customerId" = c.id
          AND i.status IN ('UNPAID', 'PARTIAL')
      )
  `);

  console.log(`Resynced ${updated} customer(s) with open invoices; zeroed ${zeroed} customer(s) with none.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
