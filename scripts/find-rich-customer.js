// One-off diagnostic: find customers that have data across the most tabs of
// the new Customer Detail page. Sort by "tab coverage" so the top row is the
// best candidate to manually test all tabs against.
//
// Run with:  node scripts/find-rich-customer.js
// (No deps beyond the already-installed Prisma client.)

const { PrismaClient } = require('@prisma/client')
require('dotenv').config()
// Use a tiny dedicated connection limit so this script doesn't fight the
// running NestJS dev server for the shared pgbouncer pool.
const url = (process.env.DATABASE_URL || '') +
  (process.env.DATABASE_URL?.includes('?') ? '&' : '?') +
  'connection_limit=1&pool_timeout=60'
const prisma = new PrismaClient({ datasources: { db: { url } } })

;(async () => {
  const customers = await prisma.customer.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      branchId: true,
      currentOutstanding: true,
      _count: {
        select: {
          invoices: true,
          creditNotes: true,
          payments: true,
          quotations: true,
          prescriptions: true,
          activities: true,
        },
      },
    },
  })

  const rows = customers.map((c) => {
    const counts = c._count
    const coverage =
      (counts.invoices > 0 ? 1 : 0) +
      (counts.creditNotes > 0 ? 1 : 0) +
      (counts.payments > 0 ? 1 : 0) +
      (counts.quotations > 0 ? 1 : 0) +
      (counts.prescriptions > 0 ? 1 : 0) +
      (counts.activities > 0 ? 1 : 0)
    const totalRows =
      counts.invoices + counts.creditNotes + counts.payments +
      counts.quotations + counts.prescriptions + counts.activities
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      branchId: c.branchId ?? '(none)',
      outstanding: Number(c.currentOutstanding),
      coverage,
      totalRows,
      ...counts,
    }
  })

  // Sort: highest coverage first, then highest total row count as tiebreak.
  rows.sort((a, b) => b.coverage - a.coverage || b.totalRows - a.totalRows)

  const top = rows.slice(0, 15)
  console.log('\n=== Top 15 customers by tab-data coverage ===\n')
  console.log(
    'coverage'.padEnd(9) +
      'inv'.padEnd(5) +
      'cn'.padEnd(5) +
      'pay'.padEnd(5) +
      'qt'.padEnd(5) +
      'rx'.padEnd(5) +
      'act'.padEnd(5) +
      'out₹'.padEnd(11) +
      'branch'.padEnd(28) +
      'name (id)',
  )
  console.log('-'.repeat(120))
  for (const r of top) {
    console.log(
      `${r.coverage}/6`.padEnd(9) +
        String(r.invoices).padEnd(5) +
        String(r.creditNotes).padEnd(5) +
        String(r.payments).padEnd(5) +
        String(r.quotations).padEnd(5) +
        String(r.prescriptions).padEnd(5) +
        String(r.activities).padEnd(5) +
        r.outstanding.toFixed(0).padEnd(11) +
        String(r.branchId).slice(0, 26).padEnd(28) +
        `${r.name}  (${r.id})`,
    )
  }

  // Highlight the single best test candidate.
  const best = rows[0]
  if (best) {
    console.log(
      `\nBest test candidate → ${best.name} (id: ${best.id})  branch: ${best.branchId}` +
        `\n  Tabs with data: ` +
        [
          best.invoices > 0 && 'Invoices',
          best.creditNotes > 0 && 'CreditNotes',
          best.payments > 0 && 'Payments',
          best.quotations > 0 && 'Quotations',
          best.prescriptions > 0 && 'Rx',
          best.activities > 0 && 'Activity',
        ]
          .filter(Boolean)
          .join(', ') +
        `\n  Detail URL: /customers/detail?customerId=${best.id}\n`,
    )
  }

  await prisma.$disconnect()
})().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
