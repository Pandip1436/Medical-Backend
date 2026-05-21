// Diagnose: why didn't the auto-WhatsApp message arrive for the most recent invoice?
// Reads the last few WhatsAppMessage rows + last PaymentLink + the related Customer/Invoice.
//
// Run with:  node scripts/diagnose-whatsapp.js
// (Uses the same DATABASE_URL as the rest of the backend — i.e. the prod Neon DB.)

const { PrismaClient } = require('@prisma/client')
require('dotenv').config()
// Allow overriding the DATABASE_URL via the first CLI arg or PROD_DATABASE_URL
// env var, so we can point at the prod Neon DB without polluting the dev .env.
// Usage:
//   node scripts/diagnose-whatsapp.js                       (uses .env DATABASE_URL — DEV)
//   node scripts/diagnose-whatsapp.js "postgresql://..."    (uses arg — PROD)
//   PROD_DATABASE_URL=... node scripts/diagnose-whatsapp.js (uses env — PROD)
const overrideUrl = process.argv[2] || process.env.PROD_DATABASE_URL
const baseUrl = overrideUrl || process.env.DATABASE_URL || ''
const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'connection_limit=1&pool_timeout=60'
console.log(`Connecting to: ${baseUrl.replace(/:[^:@]+@/, ':***@').slice(0, 80)}...\n`)
const prisma = new PrismaClient({ datasources: { db: { url } } })

async function main() {
  console.log('\n=== Last 5 WhatsAppMessage rows ===')
  const msgs = await prisma.whatsAppMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
  })
  if (msgs.length === 0) {
    console.log('  (no rows — listener never reached WhatsApp send step)')
  } else {
    for (const m of msgs) {
      console.log(`\n  id:           ${m.id}`)
      console.log(`  createdAt:    ${m.createdAt.toISOString()}`)
      console.log(`  to:           ${m.to}`)
      console.log(`  templateName: ${m.templateName}`)
      console.log(`  status:       ${m.status}`)
      console.log(`  attempts:     ${m.attempts}`)
      console.log(`  errorCode:    ${m.errorCode ?? '-'}`)
      console.log(`  errorMessage: ${m.errorMessage ?? '-'}`)
      console.log(`  relatedTo:    ${m.relatedEntityType}/${m.relatedEntityId}`)
      console.log(`  mediaUrl:     ${m.mediaUrl ? m.mediaUrl.slice(0, 80) + '...' : '-'}`)
    }
  }

  console.log('\n=== Last 3 PaymentLink rows ===')
  const links = await prisma.paymentLink.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: { invoice: { select: { invoiceNumber: true, customerName: true } } },
  })
  if (links.length === 0) {
    console.log('  (no rows — Razorpay payment-link creation never succeeded)')
  } else {
    for (const l of links) {
      console.log(`\n  invoice:      ${l.invoice?.invoiceNumber} (${l.invoice?.customerName})`)
      console.log(`  status:       ${l.status}`)
      console.log(`  providerQrId: ${l.providerQrId}`)
      console.log(`  amount:       ${l.amount}`)
      console.log(`  paidAmount:   ${l.paidAmount}`)
      console.log(`  shortUrl:     ${l.shortUrl}`)
      console.log(`  createdAt:    ${l.createdAt.toISOString()}`)
    }
  }

  console.log('\n=== Last 3 invoices and customer WhatsApp settings ===')
  const inv = await prisma.invoice.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          phone: true,
          whatsappNumber: true,
          whatsappOptIn: true,
        },
      },
    },
  })
  for (const i of inv) {
    console.log(`\n  invoice:        ${i.invoiceNumber}`)
    console.log(`  type:           ${i.type}`)
    console.log(`  status:         ${i.status}`)
    console.log(`  grandTotal:     ${i.grandTotal}`)
    console.log(`  amountPaid:     ${i.amountPaid}`)
    console.log(`  paymentDetails: ${JSON.stringify(i.paymentDetails)}`)
    console.log(`  customer:       ${i.customer?.name} / phone=${i.customer?.phone} / waNumber=${i.customer?.whatsappNumber ?? '-'} / optIn=${i.customer?.whatsappOptIn}`)
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
