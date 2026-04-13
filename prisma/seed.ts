import { PrismaClient, Role, ProductCategory, StorageCondition, Schedule, PaymentTerms, InvoiceType, BillingType, PaymentMode, InvoiceStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = 'admin@pbims.com';
  
  // 1. Create Admin
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  let admin = existingAdmin;
  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    admin = await prisma.user.create({
      data: {
        name: 'Super Admin',
        email: adminEmail,
        phone: '1234567890',
        password: hashedPassword,
        role: Role.ADMIN,
      }
    });
    console.log('✅ Admin user created');
  }

  // 2. Create Suppliers
  const suppliers = await Promise.all([
    prisma.supplier.upsert({
      where: { id: 'supp_1' },
      update: {},
      create: {
        id: 'supp_1', name: 'Alkem Laboratories', contactPerson: 'Mr. Sharma',
        phone: '9876543210', email: 'vapi@alkem.com', gstin: '24AAAAA0000A1Z5',
        drugLicense: 'DL-12345', address: 'Mumbai, India', paymentTerms: PaymentTerms.NET_30
      }
    }),
    prisma.supplier.upsert({
      where: { id: 'supp_2' },
      update: {},
      create: {
        id: 'supp_2', name: 'Cipla Ltd', contactPerson: 'Mr. Gupta',
        phone: '9876543211', email: 'sales@cipla.com', gstin: '27AAAAA0001A1Z5',
        drugLicense: 'DL-67890', address: 'Pune, India', paymentTerms: PaymentTerms.NET_45
      }
    })
  ]);

  // 3. Create Products
  const categories = [ProductCategory.ONCOLOGY, ProductCategory.NEPHROLOGY, ProductCategory.GENERAL, ProductCategory.OTC];
  const productData = [
    { name: 'Rituximab 500mg', generic: 'Rituximab', cat: ProductCategory.ONCOLOGY, price: 23500 },
    { name: 'Bevacizumab 400mg', generic: 'Bevacizumab', cat: ProductCategory.ONCOLOGY, price: 20500 },
    { name: 'Tacrolimus 1mg', generic: 'Tacrolimus', cat: ProductCategory.NEPHROLOGY, price: 295 },
    { name: 'Furosemide 40mg', generic: 'Furosemide', cat: ProductCategory.GENERAL, price: 15 },
    { name: 'Paracetamol 650mg', generic: 'Paracetamol', cat: ProductCategory.OTC, price: 30 }
  ];

  const products = await Promise.all(productData.map((p, i) => 
    prisma.product.upsert({
      where: { id: `prod_${i}` },
      update: {},
      create: {
        id: `prod_${i}`, name: p.name, genericName: p.generic, manufacturer: 'PharmaCorp',
        category: p.cat, packSize: '10s', unitOfMeasure: 'Box', hsnCode: '3004',
        storageCondition: StorageCondition.ROOM_TEMP, mrp: p.price, purchaseRate: p.price * 0.7,
        sellingRate: p.price * 0.95, wholesaleRate: p.price * 0.85, gstRate: 12,
        minStock: 10, maxStock: 100, reorderQty: 20, rackLocation: 'A-1'
      }
    })
  ));

  // 4. Create Batches
  await Promise.all(products.map((p, i) => 
    prisma.batch.create({
      data: {
        productId: p.id, batchNumber: `BATCH-00${i}`, mfgDate: dayjs().subtract(3, 'months').toDate(),
        expiryDate: dayjs().add(12, 'months').toDate(), quantity: 50, mrp: p.mrp,
        purchaseRate: p.purchaseRate, supplierId: suppliers[i % 2].id
      }
    })
  ));

  // 5. Create Invoices (Today)
  const customers = await prisma.customer.findMany({ take: 3 });
  if (customers.length > 0) {
    for (let i = 0; i < 15; i++) {
      const date = dayjs().startOf('day').add(9 + Math.floor(i * 0.8), 'hour').toDate();
      const amount = Math.floor(Math.random() * 10000) + 1000;
      
      await prisma.invoice.create({
        data: {
          invoiceNumber: `INV-${Date.now()}-${i}`,
          date: date,
          type: InvoiceType.INVOICE,
          billingType: BillingType.RETAIL,
          customerId: customers[0].id,
          customerName: customers[0].name,
          grandTotal: amount,
          subtotal: amount * 0.9,
          taxableAmount: amount * 0.8,
          cgst: amount * 0.06,
          sgst: amount * 0.06,
          paymentMode: PaymentMode.CASH,
          status: InvoiceStatus.PAID,
          amountPaid: amount,
          createdById: admin!.id
        }
      });
    }
  }

  console.log('✅ Database seeded successfully');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
