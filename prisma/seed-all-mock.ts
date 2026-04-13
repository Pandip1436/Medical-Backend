import { PrismaClient, Role, CustomerType, ProductCategory, Schedule, StorageCondition, POStatus, GRNStatus, InvoiceType, BillingType, PaymentMode, InvoiceStatus, PaymentTerms } from '@prisma/client';
import { mockUsers, mockProducts, mockBatches, mockCustomers } from './mock';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding all mock data to the database...');

  // 1. Clear existing data in a safe order
  // (Ignoring dependencies for simplicity in this script, assuming a fresh or clean-able DB)
  // In a real app, you'd handle cascades or delete in specific order.
  
  // 2. Seed Users
  for (const user of mockUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: {
        name: user.name,
        email: user.email,
        phone: user.phone,
        password: user.password, // Ideally hashed, but keeping as is for mock consistency
        role: user.role.toUpperCase() as Role,
        isActive: user.isActive,
      },
    });
  }

  // 3. Seed Supplier (Needed for Batches)
  // The mock data doesn't explicitly list suppliers as a top-level export in my previous view_file, 
  // but batches reference SUP-001, etc. Let's create a few.
  const suppliers = [
    { id: 'SUP-001', name: 'Global Pharma Distributors', contactPerson: 'Mr. Sharma', phone: '9876543211', email: 'sales@globalpharma.com', address: 'Industrial Area', gstin: '29ABCDE1234F1Z5', drugLicense: 'DL-12345', paymentTerms: 'NET_30' },
    { id: 'SUP-002', name: 'Zydus Healthcare', contactPerson: 'Ms. Gupta', phone: '9876543212', email: 'zydus@example.com', address: 'Ahmedabad', gstin: '24ABCDE1234F1Z5', drugLicense: 'DL-23456', paymentTerms: 'NET_45' },
    { id: 'SUP-003', name: 'Sun Pharma Distribution', contactPerson: 'Mr. Verma', phone: '9876543213', email: 'sunpharma@example.com', address: 'Mumbai', gstin: '27ABCDE1234F1Z5', drugLicense: 'DL-34567', paymentTerms: 'NET_30' },
    { id: 'SUP-004', name: 'Natco Fine Chemicals', contactPerson: 'Mr. Rao', phone: '9876543214', email: 'natco@example.com', address: 'Hyderabad', gstin: '36ABCDE1234F1Z5', drugLicense: 'DL-45678', paymentTerms: 'NET_60' },
    { id: 'SUP-005', name: 'Hetero Logistics', contactPerson: 'Ms. Rao', phone: '9876543215', email: 'hetero@example.com', address: 'Hyderabad', gstin: '36ABCDE5678F1Z5', drugLicense: 'DL-56789', paymentTerms: 'NET_30' },
  ];

  for (const sup of suppliers) {
    await prisma.supplier.upsert({
      where: { id: sup.id },
      update: {},
      create: {
        id: sup.id,
        name: sup.name,
        contactPerson: sup.contactPerson,
        phone: sup.phone,
        email: sup.email,
        address: sup.address,
        gstin: sup.gstin,
        drugLicense: sup.drugLicense,
        paymentTerms: sup.paymentTerms as PaymentTerms,
      },
    });
  }

  // 4. Seed Customers
  for (const customer of mockCustomers) {
    await prisma.customer.upsert({
      where: { id: customer.id },
      update: {},
      create: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        alternatePhone: customer.alternatePhone,
        email: customer.email,
        address: customer.address,
        type: customer.type.toUpperCase() as CustomerType,
        creditLimit: customer.creditLimit,
        currentOutstanding: customer.currentOutstanding,
        loyaltyPoints: customer.loyaltyPoints,
        gstin: customer.gstin,
        dlNumber: customer.dlNumber,
        notes: customer.notes,
      },
    });
  }

  // 5. Seed Products
  for (const prod of mockProducts) {
    await prisma.product.upsert({
      where: { id: prod.id },
      update: {},
      create: {
        id: prod.id,
        name: prod.name,
        genericName: prod.genericName,
        manufacturer: prod.manufacturer,
        category: (prod.category.toUpperCase() === 'NEPHROLOGY' || prod.category.toUpperCase() === 'ONCOLOGY' || prod.category.toUpperCase() === 'GENERAL' || prod.category.toUpperCase() === 'OTC' || prod.category.toUpperCase() === 'SURGICAL') 
                  ? prod.category.toUpperCase() as ProductCategory 
                  : 'GENERAL',
        subCategory: prod.subCategory,
        packSize: prod.packSize,
        unitOfMeasure: prod.unitOfMeasure,
        schedule: (prod.schedule && (prod.schedule === 'H' || prod.schedule === 'H1' || prod.schedule === 'X')) 
                  ? prod.schedule as Schedule 
                  : 'NONE',
        hsnCode: prod.hsnCode,
        isNarcotic: prod.isNarcotic,
        storageCondition: prod.storageCondition.toUpperCase() as StorageCondition,
        mrp: prod.mrp,
        purchaseRate: prod.purchaseRate,
        sellingRate: prod.sellingRate,
        wholesaleRate: prod.wholesaleRate,
        gstRate: prod.gstRate,
        minStock: prod.minStock,
        maxStock: prod.maxStock,
        reorderQty: prod.reorderQty,
        rackLocation: prod.rackLocation,
        barcode: prod.barcode,
        totalStock: prod.totalStock,
      },
    });
  }

  // 6. Seed Batches
  for (const batch of mockBatches) {
    await prisma.batch.upsert({
      where: { id: batch.id },
      update: {},
      create: {
        id: batch.id,
        productId: batch.productId,
        batchNumber: batch.batchNumber,
        mfgDate: new Date(batch.mfgDate),
        expiryDate: new Date(batch.expiryDate),
        quantity: batch.quantity,
        mrp: batch.mrp,
        purchaseRate: batch.purchaseRate,
        supplierId: batch.supplierId,
      },
    });
  }

  console.log('✅ All mock data seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
