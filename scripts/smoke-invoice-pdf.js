// Standalone smoke test for the HTML→PDF invoice pipeline.
// Renders a sample invoice through the compiled service and asserts the
// returned Buffer is a real PDF. Run: node scripts/smoke-invoice-pdf.js
const fs = require('fs');
const path = require('path');
const { InvoicePdfService } = require('../dist/src/pdf/invoice-pdf.service');

(async () => {
  const svc = new InvoicePdfService();
  const buf = await svc.render({
    invoiceNumber: 'INV-2025-000123',
    date: new Date('2025-06-08'),
    dueDate: new Date('2025-06-22'),
    customerName: 'Apollo Speciality Hospital',
    customerPhone: '+91 98400 11223',
    customerAddress: '21, Greams Lane, Off Greams Road, Chennai 600006',
    customerGstin: '33AABCA1234M1Z5',
    customerDlNumber: 'TN-CH-20B-998877',
    branchName: 'Santhosh Hospital Suppliers',
    branchAddress: '14, Medavakkam Main Road, Chennai 600100',
    branchGstin: '33AAACS5678P1Z2',
    branchPhone: '+91 44 2345 6789',
    branchEmail: 'sales@santhoshsuppliers.in',
    branchDlNumber: 'TN-CH-21B-112233 / 21B-112234',
    items: [
      { productName: 'Paracetamol 650mg Tab', batchNumber: 'PCM6501A', expiryDate: new Date('2027-03-31'), quantity: 200, mrp: 2.5, rate: 1.9, discountPercent: 0, gstPercent: 12, amount: 380 },
      { productName: 'Amoxicillin 500mg Cap', batchNumber: 'AMX500X7', expiryDate: new Date('2026-11-30'), quantity: 100, mrp: 8.0, rate: 6.4, discountPercent: 0, gstPercent: 12, amount: 640 },
      { productName: 'Normal Saline 0.9% 500ml', batchNumber: 'NS09-4421', expiryDate: new Date('2026-08-31'), quantity: 50, mrp: 45.0, rate: 38.0, discountPercent: 0, gstPercent: 5, amount: 1900 },
    ],
    subtotal: 2920,
    productDiscount: 0,
    taxableAmount: 2920,
    cgst: 116.6,
    sgst: 116.6,
    igst: 0,
    roundOff: -0.2,
    grandTotal: 3153,
    amountPaid: 1000,
    paymentQrShortUrl: 'https://pay.example.com/inv/INV-2025-000123',
    paymentQrAmount: 2153,
  });

  const isPdf = Buffer.isBuffer(buf) && buf.subarray(0, 5).toString() === '%PDF-';
  const out = path.join(__dirname, 'smoke-invoice.pdf');
  fs.writeFileSync(out, buf);
  console.log(`isBuffer=${Buffer.isBuffer(buf)}  magic=${buf.subarray(0, 5).toString()}  bytes=${buf.length}`);
  console.log(`valid PDF: ${isPdf ? 'YES' : 'NO'}  -> wrote ${out}`);

  await svc.onModuleDestroy();
  process.exit(isPdf ? 0 : 1);
})().catch((e) => { console.error('SMOKE FAILED:', e); process.exit(1); });
