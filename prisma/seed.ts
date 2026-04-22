/**
 * Multi-Branch Seed Script
 *
 * Architecture:
 *   2 Branches  →  Branch-assigned users  →  All transactional data tagged to a branch
 *
 * Data flow per branch (full end-to-end workflow):
 *   Supplier  →  PurchaseOrder  →  GRN (creates Batches)  →  Invoice  →  CreditNote
 *                                                           →  PurchaseReturn
 *   Expense per branch
 *
 * Master data (shared across branches):
 *   Suppliers, Products, Customers, Doctors
 */

import {
  PrismaClient, Role, CustomerType, ProductCategory, Schedule,
  StorageCondition, PaymentTerms, POStatus, GRNStatus,
  InvoiceType, BillingType, PaymentMode, InvoiceStatus,
  SettlementMode, PurchaseReturnStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number) { return new Date(Date.now() - n * 86_400_000); }
function daysFromNow(n: number) { return new Date(Date.now() + n * 86_400_000); }
function monthsAgo(n: number) { return daysAgo(n * 30); }
function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function hash(pw: string) { return bcrypt.hash(pw, 10); }

// ─── Purge (ordered by FK dependency) ────────────────────────────────────────

async function purge() {
  console.log('🗑️  Purging existing data...');
  await prisma.auditLog.deleteMany();
  await prisma.creditNoteItem.deleteMany();
  await prisma.creditNote.deleteMany();
  await prisma.purchaseReturnItem.deleteMany();
  await prisma.purchaseReturn.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.gRNItem.deleteMany();
  await prisma.gRN.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.prescription.deleteMany();
  await prisma.user.deleteMany();
  await prisma.branch.deleteMany();
  // Master data — delete last
  await prisma.customer.deleteMany();
  await prisma.doctor.deleteMany();
  await prisma.product.deleteMany();
  await prisma.supplier.deleteMany();
  console.log('✅ Purge complete.\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await purge();

  // ── 1. BRANCHES ─────────────────────────────────────────────────────────────
  console.log('🏢 Seeding branches...');

  const hq = await prisma.branch.create({
    data: {
      id: 'BRN-HQ',
      name: 'Hospital Suppliers - HQ (Madurai)',
      code: 'HQ',
      address: '15, Anna Nagar Main Road, Madurai - 625020',
      phone: '04522-450100',
      email: 'hq@hospitalsuppliers.com',
      gstin: '33AABCH1234A1Z5',
      drugLicense: 'TN/MDU/20A/2020/0001',
      isActive: true,
      isDefault: true,
    },
  });

  const br1 = await prisma.branch.create({
    data: {
      id: 'BRN-BR1',
      name: 'Hospital Suppliers - Chennai Branch',
      code: 'BR1',
      address: '88, Mount Road, Chennai - 600002',
      phone: '044-28450200',
      email: 'chennai@hospitalsuppliers.com',
      gstin: '33AABCH1234A2Z4',
      drugLicense: 'TN/CHE/20A/2021/0055',
      isActive: true,
      isDefault: false,
    },
  });

  console.log(`  ✅ ${hq.name}`);
  console.log(`  ✅ ${br1.name}\n`);

  // ── 2. USERS ─────────────────────────────────────────────────────────────────
  console.log('👤 Seeding users...');

  // ADMIN — no branch (sees all)
  const admin = await prisma.user.create({
    data: {
      name: 'Super Admin',
      email: 'admin@pbims.com',
      phone: '9000000001',
      password: await hash('admin123'),
      role: Role.ADMIN,
      isActive: true,
    },
  });

  // HQ staff — locked to HQ branch
  const hqPharmacist = await prisma.user.create({
    data: {
      name: 'Ravi Kumar',
      email: 'pharmacist@pbims.com',
      phone: '9000000002',
      password: await hash('pharma123'),
      role: Role.PHARMACIST,
      isActive: true,
      branchId: hq.id,
    },
  });

  const hqInventory = await prisma.user.create({
    data: {
      name: 'Kumar Singh',
      email: 'inventory@pbims.com',
      phone: '9000000003',
      password: await hash('stock123'),
      role: Role.INVENTORY_MANAGER,
      isActive: true,
      branchId: hq.id,
    },
  });

  const hqAccountant = await prisma.user.create({
    data: {
      name: 'Priya Sharma',
      email: 'accountant@pbims.com',
      phone: '9000000004',
      password: await hash('account123'),
      role: Role.ACCOUNTANT,
      isActive: true,
      branchId: hq.id,
    },
  });

  // Chennai branch staff
  const br1Pharmacist = await prisma.user.create({
    data: {
      name: 'Santhosh R',
      email: 'pharmacist.chennai@pbims.com',
      phone: '9000000005',
      password: await hash('pharma123'),
      role: Role.PHARMACIST,
      isActive: true,
      branchId: br1.id,
    },
  });

  const br1Inventory = await prisma.user.create({
    data: {
      name: 'Divya M',
      email: 'inventory.chennai@pbims.com',
      phone: '9000000006',
      password: await hash('stock123'),
      role: Role.INVENTORY_MANAGER,
      isActive: true,
      branchId: br1.id,
    },
  });

  const br1Accountant = await prisma.user.create({
    data: {
      name: 'Anand K',
      email: 'accountant.chennai@pbims.com',
      phone: '9000000007',
      password: await hash('account123'),
      role: Role.ACCOUNTANT,
      isActive: true,
      branchId: br1.id,
    },
  });

  console.log(`  ✅ 7 users created (1 Admin + 3 HQ + 3 Chennai)\n`);

  // ── 3. MASTER DATA (per-branch) ───────────────────────────────────────────────

  // HQ Suppliers
  console.log('🏭 Seeding suppliers (per branch)...');
  const [sup1, sup2, sup3] = await Promise.all([
    prisma.supplier.create({ data: { id: 'SUP-001', name: 'Global Pharma Distributors', contactPerson: 'Mr. Sharma', phone: '9876543211', email: 'sales@globalpharma.com', address: 'Industrial Area, Coimbatore', gstin: '29ABCDE1234F1Z5', drugLicense: 'DL-12345', paymentTerms: PaymentTerms.NET_30, branchId: hq.id } }),
    prisma.supplier.create({ data: { id: 'SUP-002', name: 'Zydus Healthcare', contactPerson: 'Ms. Gupta', phone: '9876543212', email: 'zydus@example.com', address: 'Ahmedabad', gstin: '24ABCDE1234F1Z5', drugLicense: 'DL-23456', paymentTerms: PaymentTerms.NET_45, branchId: hq.id } }),
    prisma.supplier.create({ data: { id: 'SUP-003', name: 'Sun Pharma Distribution', contactPerson: 'Mr. Verma', phone: '9876543213', email: 'sunpharma@example.com', address: 'Mumbai', gstin: '27ABCDE1234F1Z5', drugLicense: 'DL-34567', paymentTerms: PaymentTerms.NET_30, branchId: hq.id } }),
  ]);
  // Chennai Suppliers
  const [sup4, sup5] = await Promise.all([
    prisma.supplier.create({ data: { id: 'SUP-004', name: 'Natco Fine Chemicals', contactPerson: 'Mr. Rao', phone: '9876543214', email: 'natco@example.com', address: 'Hyderabad', gstin: '36ABCDE1234F1Z5', drugLicense: 'DL-45678', paymentTerms: PaymentTerms.NET_60, branchId: br1.id } }),
    prisma.supplier.create({ data: { id: 'SUP-005', name: 'Hetero Logistics', contactPerson: 'Ms. Rao', phone: '9876543215', email: 'hetero@example.com', address: 'Hyderabad', gstin: '36ABCDE5678F1Z5', drugLicense: 'DL-56789', paymentTerms: PaymentTerms.NET_30, branchId: br1.id } }),
  ]);
  console.log('  ✅ 3 HQ suppliers + 2 Chennai suppliers\n');

  // HQ Doctors
  console.log('👨‍⚕️ Seeding doctors (per branch)...');
  const [doc1, doc2] = await Promise.all([
    prisma.doctor.create({ data: { name: 'Dr. Balaji R', specialization: 'Nephrology', phone: '9944001122', regNumber: 'TN-12345', email: 'drbalaji@gmail.com', address: 'Goripalayam, Madurai', branchId: hq.id } }),
    prisma.doctor.create({ data: { name: 'Dr. Anitha S', specialization: 'Oncology', phone: '9944002233', regNumber: 'TN-23456', email: 'dranitha@gmail.com', address: 'Alwarpet, Chennai', branchId: hq.id } }),
  ]);
  // Chennai Doctor
  const [doc3] = await Promise.all([
    prisma.doctor.create({ data: { name: 'Dr. Venkatesh P', specialization: 'General Medicine', phone: '9944003344', regNumber: 'TN-34567', email: 'drvenkatesh@gmail.com', address: 'Anna Nagar, Chennai', branchId: br1.id } }),
  ]);
  console.log('  ✅ 2 HQ doctors + 1 Chennai doctor\n');

  // HQ Customers
  console.log('👥 Seeding customers (per branch)...');
  const [cust1, cust3, cust4, walkIn] = await Promise.all([
    prisma.customer.create({ data: { id: 'CUS-001', name: 'Apollo Hospital - Madurai', phone: '9944112233', email: 'pharmacy@apollomadurai.com', address: '11, KK Nagar, Madurai - 625020', type: CustomerType.WHOLESALE, creditLimit: 500000, currentOutstanding: 0, gstin: '33AABCA1234A1Z5', dlNumber: 'TN/MDU/20B/2021/1001', branchId: hq.id } }),
    prisma.customer.create({ data: { id: 'CUS-003', name: 'MedPlus - Madurai', phone: '9944445566', email: 'madurai@medplus.in', address: '45, Anna Nagar, Madurai', type: CustomerType.WHOLESALE, creditLimit: 300000, currentOutstanding: 0, gstin: '33AABCD3456D4Z3', dlNumber: 'TN/MDU/21B/2022/1205', branchId: hq.id } }),
    prisma.customer.create({ data: { id: 'CUS-004', name: 'Murugan S', phone: '9944667788', address: '12/3, Simmakkal, Madurai', type: CustomerType.RETAIL, creditLimit: 10000, currentOutstanding: 0, loyaltyPoints: 320, branchId: hq.id } }),
    prisma.customer.create({ data: { id: 'CUS-WALKIN-HQ', name: 'Walk-in Customer (HQ)', phone: '0000000001', type: CustomerType.RETAIL, creditLimit: 0, currentOutstanding: 0, branchId: hq.id } }),
  ]);
  // Chennai Customers
  const [cust2, cust5, walkIn2] = await Promise.all([
    prisma.customer.create({ data: { id: 'CUS-002', name: 'MIOT Hospital - Chennai', phone: '9944223344', email: 'purchase@miothospitals.com', address: '4/112, Mount Poonamallee Road, Chennai - 600089', type: CustomerType.WHOLESALE, creditLimit: 750000, currentOutstanding: 0, gstin: '33AABCM5678B2Z1', dlNumber: 'TN/CHE/20B/2020/0852', branchId: br1.id } }),
    prisma.customer.create({ data: { id: 'CUS-005', name: 'Lakshmi K', phone: '9944778899', address: '56, Tallakulam, Madurai', type: CustomerType.RETAIL, creditLimit: 15000, currentOutstanding: 0, loyaltyPoints: 540, branchId: br1.id } }),
    prisma.customer.create({ data: { id: 'CUS-WALKIN-BR1', name: 'Walk-in Customer (Chennai)', phone: '0000000002', type: CustomerType.RETAIL, creditLimit: 0, currentOutstanding: 0, branchId: br1.id } }),
  ]);
  console.log('  ✅ 4 HQ customers + 3 Chennai customers\n');

  // HQ Products (PRD-001 to PRD-006)
  console.log('💊 Seeding products (per branch)...');

  type ProductInput = {
    id: string; name: string; generic: string; manufacturer: string;
    cat: ProductCategory; sub: string; pack: string; uom: string;
    sched: Schedule; hsn: string; storage: StorageCondition;
    mrp: number; pr: number; sr: number; wr: number; gst: number;
    min: number; max: number; reorder: number; rack: string; barcode: string;
    branchId: string;
  };

  const hqProductDefs: ProductInput[] = [
    { id: 'PRD-HQ-001', name: 'Torsemide 20mg Tab', generic: 'Torsemide', manufacturer: 'Cipla Ltd', cat: ProductCategory.NEPHROLOGY, sub: 'Diuretics', pack: '10x10', uom: 'Strip', sched: Schedule.H, hsn: '30049099', storage: StorageCondition.ROOM_TEMP, mrp: 85, pr: 52, sr: 78, wr: 68, gst: 12, min: 100, max: 1000, reorder: 200, rack: 'A1-01', barcode: 'HQ-8901234560011', branchId: hq.id },
    { id: 'PRD-HQ-002', name: 'Erythropoietin 4000IU Inj', generic: 'Epoetin Alfa', manufacturer: "Dr. Reddy's", cat: ProductCategory.NEPHROLOGY, sub: 'Hematopoietic Agents', pack: '1 Vial', uom: 'Vial', sched: Schedule.H, hsn: '30021200', storage: StorageCondition.REFRIGERATED, mrp: 1250, pr: 850, sr: 1150, wr: 1020, gst: 12, min: 20, max: 200, reorder: 50, rack: 'R1-01', barcode: 'HQ-8901234560028', branchId: hq.id },
    { id: 'PRD-HQ-003', name: 'Ondansetron 4mg Tab', generic: 'Ondansetron', manufacturer: 'Sun Pharmaceutical', cat: ProductCategory.ONCOLOGY, sub: 'Antiemetics', pack: '10x10', uom: 'Strip', sched: Schedule.H, hsn: '30049099', storage: StorageCondition.ROOM_TEMP, mrp: 62.5, pr: 38, sr: 56, wr: 48, gst: 12, min: 150, max: 1500, reorder: 300, rack: 'B2-03', barcode: 'HQ-8901234560035', branchId: hq.id },
    { id: 'PRD-HQ-004', name: 'Tacrolimus 1mg Cap', generic: 'Tacrolimus', manufacturer: 'Hetero Drugs', cat: ProductCategory.NEPHROLOGY, sub: 'Immunosuppressants', pack: '10x6', uom: 'Strip', sched: Schedule.H1, hsn: '30049099', storage: StorageCondition.COOL_DRY, mrp: 320, pr: 210, sr: 295, wr: 260, gst: 12, min: 50, max: 500, reorder: 100, rack: 'A2-04', barcode: 'HQ-8901234560042', branchId: hq.id },
    { id: 'PRD-HQ-005', name: 'Losartan 50mg Tab', generic: 'Losartan Potassium', manufacturer: 'Cipla Ltd', cat: ProductCategory.NEPHROLOGY, sub: 'ARBs', pack: '10x10', uom: 'Strip', sched: Schedule.H, hsn: '30049099', storage: StorageCondition.ROOM_TEMP, mrp: 68, pr: 40, sr: 62, wr: 54, gst: 12, min: 200, max: 2000, reorder: 400, rack: 'A1-05', barcode: 'HQ-8901234560128', branchId: hq.id },
    { id: 'PRD-HQ-006', name: 'Furosemide 40mg Tab', generic: 'Furosemide', manufacturer: 'Cipla Ltd', cat: ProductCategory.NEPHROLOGY, sub: 'Loop Diuretics', pack: '10x15', uom: 'Strip', sched: Schedule.H, hsn: '30049099', storage: StorageCondition.ROOM_TEMP, mrp: 28, pr: 16, sr: 25, wr: 22, gst: 12, min: 300, max: 3000, reorder: 500, rack: 'A1-02', barcode: 'HQ-8901234560142', branchId: hq.id },
  ];

  const br1ProductDefs: ProductInput[] = [
    { id: 'PRD-BR1-001', name: 'Cisplatin 50mg Inj', generic: 'Cisplatin', manufacturer: 'Natco Pharma', cat: ProductCategory.ONCOLOGY, sub: 'Alkylating Agents', pack: '1 Vial', uom: 'Vial', sched: Schedule.H, hsn: '30049099', storage: StorageCondition.ROOM_TEMP, mrp: 450, pr: 290, sr: 420, wr: 370, gst: 12, min: 30, max: 300, reorder: 50, rack: 'C1-02', barcode: 'BR1-8901234560059', branchId: br1.id },
    { id: 'PRD-BR1-002', name: 'Imatinib 400mg Tab', generic: 'Imatinib Mesylate', manufacturer: 'Natco Pharma', cat: ProductCategory.ONCOLOGY, sub: 'Tyrosine Kinase Inhibitors', pack: '10x3', uom: 'Strip', sched: Schedule.H1, hsn: '30049099', storage: StorageCondition.ROOM_TEMP, mrp: 2800, pr: 1850, sr: 2600, wr: 2300, gst: 12, min: 20, max: 200, reorder: 40, rack: 'C2-01', barcode: 'BR1-8901234560111', branchId: br1.id },
    { id: 'PRD-BR1-003', name: 'Paclitaxel 260mg Inj', generic: 'Paclitaxel', manufacturer: 'Natco Pharma', cat: ProductCategory.ONCOLOGY, sub: 'Taxanes', pack: '1 Vial', uom: 'Vial', sched: Schedule.H, hsn: '30049099', storage: StorageCondition.REFRIGERATED, mrp: 8500, pr: 5800, sr: 7900, wr: 7200, gst: 12, min: 10, max: 100, reorder: 20, rack: 'R1-03', barcode: 'BR1-8901234560073', branchId: br1.id },
    { id: 'PRD-BR1-004', name: 'Rituximab 500mg Inj', generic: 'Rituximab', manufacturer: 'Hetero Drugs', cat: ProductCategory.ONCOLOGY, sub: 'Monoclonal Antibodies', pack: '1 Vial', uom: 'Vial', sched: Schedule.H, hsn: '30021400', storage: StorageCondition.REFRIGERATED, mrp: 25000, pr: 18000, sr: 23500, wr: 21500, gst: 12, min: 5, max: 50, reorder: 10, rack: 'R2-01', barcode: 'BR1-8901234560204', branchId: br1.id },
  ];

  const hqProducts = await Promise.all(hqProductDefs.map(p =>
    prisma.product.create({
      data: {
        id: p.id, name: p.name, genericName: p.generic, manufacturer: p.manufacturer,
        category: p.cat, subCategory: p.sub, packSize: p.pack, unitOfMeasure: p.uom,
        schedule: p.sched, hsnCode: p.hsn, storageCondition: p.storage,
        mrp: p.mrp, purchaseRate: p.pr, sellingRate: p.sr, wholesaleRate: p.wr,
        gstRate: p.gst, minStock: p.min, maxStock: p.max, reorderQty: p.reorder,
        rackLocation: p.rack, barcode: p.barcode, totalStock: 0, branchId: p.branchId,
      },
    })
  ));

  const br1Products = await Promise.all(br1ProductDefs.map(p =>
    prisma.product.create({
      data: {
        id: p.id, name: p.name, genericName: p.generic, manufacturer: p.manufacturer,
        category: p.cat, subCategory: p.sub, packSize: p.pack, unitOfMeasure: p.uom,
        schedule: p.sched, hsnCode: p.hsn, storageCondition: p.storage,
        mrp: p.mrp, purchaseRate: p.pr, sellingRate: p.sr, wholesaleRate: p.wr,
        gstRate: p.gst, minStock: p.min, maxStock: p.max, reorderQty: p.reorder,
        rackLocation: p.rack, barcode: p.barcode, totalStock: 0, branchId: p.branchId,
      },
    })
  ));

  const products = [...hqProducts, ...br1Products];
  console.log(`  ✅ ${hqProducts.length} HQ products + ${br1Products.length} Chennai products\n`);

  // ── 4. HQ BRANCH WORKFLOW ────────────────────────────────────────────────────
  console.log('🏢 [HQ] Seeding branch workflow...');

  // 4a. Purchase Order → HQ
  const hqPO = await prisma.purchaseOrder.create({
    data: {
      poNumber: 'HQ-PO-001',
      date: monthsAgo(2),
      branchId: hq.id,
      supplierId: sup1.id,
      supplierName: sup1.name,
      totalAmount: 185000,
      status: POStatus.FULLY_RECEIVED,
      expectedDelivery: monthsAgo(2),
      createdBy: hqInventory.id,
      items: {
        create: [
          { productId: products[0].id, productName: products[0].name, requiredQty: 500, lastPurchaseRate: 52, expectedRate: 52, receivedQty: 500 },
          { productId: products[3].id, productName: products[3].name, requiredQty: 100, lastPurchaseRate: 210, expectedRate: 210, receivedQty: 100 },
          { productId: products[4].id, productName: products[4].name, requiredQty: 800, lastPurchaseRate: 40, expectedRate: 40, receivedQty: 800 },
        ],
      },
    },
  });

  // 4b. GRN → HQ (creates inventory)
  const hqGRN = await prisma.gRN.create({
    data: {
      grnNumber: 'HQ-GRN-001',
      date: monthsAgo(2),
      branchId: hq.id,
      poId: hqPO.id,
      supplierId: sup1.id,
      supplierName: sup1.name,
      supplierInvoiceNo: 'GP-INV-2026-0411',
      supplierInvoiceDate: monthsAgo(2),
      supplierInvoiceAmount: 185000,
      totalAmount: 185000,
      status: GRNStatus.VERIFIED,
      items: {
        create: [
          { productId: products[0].id, productName: products[0].name, orderedQty: 500, receivedQty: 500, batchNumber: 'HQ-TOR-B1', mfgDate: monthsAgo(6), expiryDate: daysFromNow(365 * 2), purchaseRate: 52, mrp: 85 },
          { productId: products[3].id, productName: products[3].name, orderedQty: 100, receivedQty: 100, batchNumber: 'HQ-TAC-B1', mfgDate: monthsAgo(4), expiryDate: daysFromNow(365 * 2), purchaseRate: 210, mrp: 320 },
          { productId: products[4].id, productName: products[4].name, orderedQty: 800, receivedQty: 800, batchNumber: 'HQ-LOS-B1', mfgDate: monthsAgo(3), expiryDate: daysFromNow(365 * 2), purchaseRate: 40, mrp: 68 },
        ],
      },
    },
  });

  // Create batches from HQ GRN
  const [hqBatch1, hqBatch2, hqBatch3] = await Promise.all([
    prisma.batch.create({ data: { productId: products[0].id, batchNumber: 'HQ-TOR-B1', mfgDate: monthsAgo(6), expiryDate: daysFromNow(730), quantity: 500, mrp: 85, purchaseRate: 52, supplierId: sup1.id } }),
    prisma.batch.create({ data: { productId: products[3].id, batchNumber: 'HQ-TAC-B1', mfgDate: monthsAgo(4), expiryDate: daysFromNow(730), quantity: 100, mrp: 320, purchaseRate: 210, supplierId: sup1.id } }),
    prisma.batch.create({ data: { productId: products[4].id, batchNumber: 'HQ-LOS-B1', mfgDate: monthsAgo(3), expiryDate: daysFromNow(730), quantity: 800, mrp: 68, purchaseRate: 40, supplierId: sup1.id } }),
  ]);
  // Near-expiry and expired batches for realistic Expiry Management data
  await Promise.all([
    prisma.batch.create({ data: { productId: products[1].id, batchNumber: 'HQ-EPO-EXP1', mfgDate: monthsAgo(24), expiryDate: daysAgo(15), quantity: 8, mrp: 1250, purchaseRate: 850, supplierId: sup2.id } }),
    prisma.batch.create({ data: { productId: products[2].id, batchNumber: 'HQ-OND-30D', mfgDate: monthsAgo(18), expiryDate: daysFromNow(22), quantity: 60, mrp: 62.5, purchaseRate: 38, supplierId: sup2.id } }),
    prisma.batch.create({ data: { productId: products[5].id, batchNumber: 'HQ-FUR-90D', mfgDate: monthsAgo(12), expiryDate: daysFromNow(75), quantity: 200, mrp: 28, purchaseRate: 16, supplierId: sup1.id } }),
  ]);
  await Promise.all([
    prisma.product.update({ where: { id: products[0].id }, data: { totalStock: { increment: 500 } } }),
    prisma.product.update({ where: { id: products[1].id }, data: { totalStock: { increment: 8 } } }),
    prisma.product.update({ where: { id: products[2].id }, data: { totalStock: { increment: 60 } } }),
    prisma.product.update({ where: { id: products[3].id }, data: { totalStock: { increment: 100 } } }),
    prisma.product.update({ where: { id: products[4].id }, data: { totalStock: { increment: 800 } } }),
    prisma.product.update({ where: { id: products[5].id }, data: { totalStock: { increment: 200 } } }),
  ]);

  // 4c. Invoices → HQ (spread across last 90 days, various statuses)
  console.log('  🧾 Creating HQ invoices...');
  const hqInvoices: string[] = [];

  // PAID invoices — retail sales for past 3 months
  const hqInvoiceData = [
    { days: 90, amount: 8500, cust: cust1, mode: PaymentMode.CREDIT, status: InvoiceStatus.CREDIT, amountPaid: 0, product: products[0], batch: hqBatch1, qty: 20 },
    { days: 75, amount: 12400, cust: cust1, mode: PaymentMode.CASH, status: InvoiceStatus.PAID, amountPaid: 12400, product: products[4], batch: hqBatch3, qty: 50 },
    { days: 60, amount: 63000, cust: cust1, mode: PaymentMode.CREDIT, status: InvoiceStatus.CREDIT, amountPaid: 0, product: products[3], batch: hqBatch2, qty: 30 },
    { days: 45, amount: 9800, cust: cust3, mode: PaymentMode.CASH, status: InvoiceStatus.PAID, amountPaid: 9800, product: products[0], batch: hqBatch1, qty: 30 },
    { days: 30, amount: 5600, cust: cust4, mode: PaymentMode.UPI, status: InvoiceStatus.PAID, amountPaid: 5600, product: products[4], batch: hqBatch3, qty: 25 },
    { days: 20, amount: 42000, cust: cust1, mode: PaymentMode.CREDIT, status: InvoiceStatus.PARTIAL, amountPaid: 20000, product: products[3], batch: hqBatch2, qty: 20 },
    { days: 15, amount: 3400, cust: walkIn, mode: PaymentMode.CASH, status: InvoiceStatus.PAID, amountPaid: 3400, product: products[0], batch: hqBatch1, qty: 10 },
    { days: 10, amount: 17000, cust: cust3, mode: PaymentMode.CARD, status: InvoiceStatus.PAID, amountPaid: 17000, product: products[4], batch: hqBatch3, qty: 80 },
    { days: 5, amount: 2800, cust: walkIn, mode: PaymentMode.UPI, status: InvoiceStatus.PAID, amountPaid: 2800, product: products[0], batch: hqBatch1, qty: 8 },
    { days: 2, amount: 6800, cust: cust4, mode: PaymentMode.CASH, status: InvoiceStatus.PAID, amountPaid: 6800, product: products[4], batch: hqBatch3, qty: 30 },
    { days: 1, amount: 9600, cust: cust3, mode: PaymentMode.UPI, status: InvoiceStatus.PAID, amountPaid: 9600, product: products[0], batch: hqBatch1, qty: 28 },
    { days: 0, amount: 21000, cust: cust1, mode: PaymentMode.CREDIT, status: InvoiceStatus.CREDIT, amountPaid: 0, product: products[3], batch: hqBatch2, qty: 10 },
  ];

  for (let i = 0; i < hqInvoiceData.length; i++) {
    const d = hqInvoiceData[i];
    const taxable = d.amount * 0.9;
    const cgst = taxable * 0.06;
    const inv = await prisma.invoice.create({
      data: {
        invoiceNumber: `HQ-INV-${String(i + 1).padStart(4, '0')}`,
        date: daysAgo(d.days),
        type: InvoiceType.INVOICE,
        billingType: d.cust.type === CustomerType.WHOLESALE ? BillingType.WHOLESALE : BillingType.RETAIL,
        branchId: hq.id,
        customerId: d.cust.id,
        customerName: d.cust.name,
        doctorId: doc1.id,
        doctorName: doc1.name,
        subtotal: d.amount,
        productDiscount: 0,
        taxableAmount: taxable,
        cgst: cgst,
        sgst: cgst,
        igst: 0,
        grandTotal: d.amount,
        paymentMode: d.mode,
        status: d.status,
        amountPaid: d.amountPaid,
        createdById: hqPharmacist.id,
        items: {
          create: [{
            productId: d.product.id,
            productName: d.product.name,
            batchId: d.batch.id,
            batchNumber: d.batch.batchNumber,
            expiryDate: daysFromNow(730),
            quantity: d.qty,
            mrp: Number(d.product.mrp),
            rate: Number(d.product.sellingRate),
            discountPercent: 0,
            gstPercent: 12,
            amount: d.amount,
          }],
        },
      },
    });
    hqInvoices.push(inv.id);
  }

  // 4d. Credit Note → HQ (return on first invoice)
  const firstHqInv = await prisma.invoice.findFirst({ where: { branchId: hq.id }, orderBy: { date: 'asc' } });
  if (firstHqInv) {
    await prisma.creditNote.create({
      data: {
        creditNoteNo: 'HQ-CN-0001',
        date: daysAgo(85),
        branchId: hq.id,
        invoiceId: firstHqInv.id,
        invoiceNumber: firstHqInv.invoiceNumber,
        customerId: cust1.id,
        customerName: cust1.name,
        reason: 'Damaged packaging — 5 strips returned',
        subtotal: 425,
        cgst: 25.5,
        sgst: 25.5,
        totalAmount: 476,
        settlementMode: SettlementMode.REFUND,
        createdById: hqPharmacist.id,
        items: {
          create: [{
            productId: products[0].id,
            productName: products[0].name,
            batchId: hqBatch1.id,
            batchNumber: hqBatch1.batchNumber,
            expiryDate: daysFromNow(730),
            returnedQty: 5,
            rate: 85,
            gstPercent: 12,
            amount: 476,
          }],
        },
      },
    });
  }

  // 4e. Purchase Return → HQ (damaged goods back to supplier)
  await prisma.purchaseReturn.create({
    data: {
      debitNoteNo: 'HQ-DN-0001',
      date: daysAgo(55),
      branchId: hq.id,
      grnId: hqGRN.id,
      supplierId: sup1.id,
      supplierName: sup1.name,
      reason: 'Short expiry — 10 strips rejected during verification',
      subtotal: 520,
      cgst: 31.2,
      sgst: 31.2,
      totalAmount: 582.4,
      status: PurchaseReturnStatus.ACCEPTED,
      createdById: hqInventory.id,
      items: {
        create: [{
          productId: products[0].id,
          productName: products[0].name,
          batchId: hqBatch1.id,
          batchNumber: hqBatch1.batchNumber,
          expiryDate: daysFromNow(730),
          returnedQty: 10,
          purchaseRate: 52,
          gstPercent: 12,
          amount: 582.4,
        }],
      },
    },
  });

  // 4f. Expenses → HQ
  await prisma.expense.createMany({
    data: [
      { date: daysAgo(60), branchId: hq.id, category: 'Electricity', description: 'EB Bill - February', amount: 8500, paymentMode: 'BANK_TRANSFER' },
      { date: daysAgo(45), branchId: hq.id, category: 'Rent', description: 'March Office Rent', amount: 35000, paymentMode: 'BANK_TRANSFER' },
      { date: daysAgo(30), branchId: hq.id, category: 'Salary', description: 'Staff Salaries - March', amount: 95000, paymentMode: 'BANK_TRANSFER' },
      { date: daysAgo(20), branchId: hq.id, category: 'Cold Storage', description: 'Refrigeration maintenance', amount: 4200, paymentMode: 'CASH' },
      { date: daysAgo(15), branchId: hq.id, category: 'Electricity', description: 'EB Bill - March', amount: 9200, paymentMode: 'BANK_TRANSFER' },
      { date: daysAgo(10), branchId: hq.id, category: 'Transport', description: 'Delivery vehicle fuel', amount: 3800, paymentMode: 'CASH' },
      { date: daysAgo(5), branchId: hq.id, category: 'Office Supplies', description: 'Stationery & printing', amount: 1200, paymentMode: 'CASH' },
      { date: daysAgo(2), branchId: hq.id, category: 'Rent', description: 'April Office Rent', amount: 35000, paymentMode: 'BANK_TRANSFER' },
    ],
  });

  console.log('  ✅ HQ: 1 PO, 1 GRN, 12 invoices, 1 credit note, 1 purchase return, 8 expenses\n');

  // ── 5. CHENNAI BRANCH WORKFLOW ───────────────────────────────────────────────
  console.log('🏪 [BR1] Seeding Chennai branch workflow...');

  // 5a. Purchase Order → Chennai
  const br1PO = await prisma.purchaseOrder.create({
    data: {
      poNumber: 'BR1-PO-001',
      date: monthsAgo(3),
      branchId: br1.id,
      supplierId: sup4.id,
      supplierName: sup4.name,
      totalAmount: 410000,
      status: POStatus.FULLY_RECEIVED,
      expectedDelivery: monthsAgo(3),
      createdBy: br1Inventory.id,
      items: {
        create: [
          { productId: products[6].id, productName: products[6].name, requiredQty: 200, lastPurchaseRate: 290, expectedRate: 290, receivedQty: 200 },
          { productId: products[8].id, productName: products[8].name, requiredQty: 20, lastPurchaseRate: 5800, expectedRate: 5800, receivedQty: 20 },
          { productId: products[9].id, productName: products[9].name, requiredQty: 5, lastPurchaseRate: 18000, expectedRate: 18000, receivedQty: 5 },
        ],
      },
    },
  });

  // Partially sent PO — pending
  await prisma.purchaseOrder.create({
    data: {
      poNumber: 'BR1-PO-002',
      date: daysAgo(10),
      branchId: br1.id,
      supplierId: sup2.id,
      supplierName: sup2.name,
      totalAmount: 62500,
      status: POStatus.SENT,
      expectedDelivery: daysFromNow(7),
      createdBy: br1Inventory.id,
      items: {
        create: [
          { productId: products[7].id, productName: products[7].name, requiredQty: 5, lastPurchaseRate: 1850, expectedRate: 1850, receivedQty: 0 },
          { productId: products[6].id, productName: products[6].name, requiredQty: 100, lastPurchaseRate: 290, expectedRate: 290, receivedQty: 0 },
        ],
      },
    },
  });

  // 5b. GRN → Chennai
  const br1GRN = await prisma.gRN.create({
    data: {
      grnNumber: 'BR1-GRN-001',
      date: monthsAgo(3),
      branchId: br1.id,
      poId: br1PO.id,
      supplierId: sup4.id,
      supplierName: sup4.name,
      supplierInvoiceNo: 'NF-INV-2026-0302',
      supplierInvoiceDate: monthsAgo(3),
      supplierInvoiceAmount: 410000,
      totalAmount: 410000,
      status: GRNStatus.VERIFIED,
      items: {
        create: [
          { productId: products[6].id, productName: products[6].name, orderedQty: 200, receivedQty: 200, batchNumber: 'BR1-CIS-B1', mfgDate: monthsAgo(5), expiryDate: daysFromNow(365 * 2), purchaseRate: 290, mrp: 450 },
          { productId: products[8].id, productName: products[8].name, orderedQty: 20, receivedQty: 20, batchNumber: 'BR1-PAC-B1', mfgDate: monthsAgo(3), expiryDate: daysFromNow(365), purchaseRate: 5800, mrp: 8500 },
          { productId: products[9].id, productName: products[9].name, orderedQty: 5, receivedQty: 5, batchNumber: 'BR1-RIT-B1', mfgDate: monthsAgo(2), expiryDate: daysFromNow(365 * 2), purchaseRate: 18000, mrp: 25000 },
        ],
      },
    },
  });

  // Create batches from Chennai GRN
  const [br1Batch1, br1Batch2, br1Batch3] = await Promise.all([
    prisma.batch.create({ data: { productId: products[6].id, batchNumber: 'BR1-CIS-B1', mfgDate: monthsAgo(5), expiryDate: daysFromNow(730), quantity: 200, mrp: 450, purchaseRate: 290, supplierId: sup4.id } }),
    prisma.batch.create({ data: { productId: products[8].id, batchNumber: 'BR1-PAC-B1', mfgDate: monthsAgo(3), expiryDate: daysFromNow(365), quantity: 20, mrp: 8500, purchaseRate: 5800, supplierId: sup4.id } }),
    prisma.batch.create({ data: { productId: products[9].id, batchNumber: 'BR1-RIT-B1', mfgDate: monthsAgo(2), expiryDate: daysFromNow(730), quantity: 5, mrp: 25000, purchaseRate: 18000, supplierId: sup4.id } }),
  ]);
  await Promise.all([
    prisma.product.update({ where: { id: products[6].id }, data: { totalStock: { increment: 200 } } }),
    prisma.product.update({ where: { id: products[8].id }, data: { totalStock: { increment: 20 } } }),
    prisma.product.update({ where: { id: products[9].id }, data: { totalStock: { increment: 5 } } }),
  ]);

  // 5c. Invoices → Chennai
  console.log('  🧾 Creating Chennai invoices...');
  const br1InvoiceData = [
    { days: 80, amount: 94500, cust: cust2, mode: PaymentMode.CREDIT, status: InvoiceStatus.CREDIT, amountPaid: 0, product: products[9], batch: br1Batch3, qty: 4 },
    { days: 60, amount: 42000, cust: cust2, mode: PaymentMode.CREDIT, status: InvoiceStatus.PARTIAL, amountPaid: 20000, product: products[8], batch: br1Batch2, qty: 5 },
    { days: 45, amount: 22500, cust: cust2, mode: PaymentMode.CASH, status: InvoiceStatus.PAID, amountPaid: 22500, product: products[6], batch: br1Batch1, qty: 50 },
    { days: 30, amount: 8500, cust: cust5, mode: PaymentMode.UPI, status: InvoiceStatus.PAID, amountPaid: 8500, product: products[6], batch: br1Batch1, qty: 20 },
    { days: 20, amount: 17000, cust: cust2, mode: PaymentMode.CREDIT, status: InvoiceStatus.CREDIT, amountPaid: 0, product: products[6], batch: br1Batch1, qty: 40 },
    { days: 14, amount: 125000, cust: cust2, mode: PaymentMode.CREDIT, status: InvoiceStatus.CREDIT, amountPaid: 0, product: products[9], batch: br1Batch3, qty: 5 },
    { days: 10, amount: 4500, cust: walkIn2, mode: PaymentMode.CASH, status: InvoiceStatus.PAID, amountPaid: 4500, product: products[6], batch: br1Batch1, qty: 10 },
    { days: 7, amount: 34000, cust: cust2, mode: PaymentMode.CARD, status: InvoiceStatus.PAID, amountPaid: 34000, product: products[8], batch: br1Batch2, qty: 4 },
    { days: 3, amount: 9000, cust: cust5, mode: PaymentMode.UPI, status: InvoiceStatus.PAID, amountPaid: 9000, product: products[6], batch: br1Batch1, qty: 20 },
    { days: 1, amount: 47500, cust: cust2, mode: PaymentMode.CREDIT, status: InvoiceStatus.CREDIT, amountPaid: 0, product: products[9], batch: br1Batch3, qty: 2 },
  ];

  for (let i = 0; i < br1InvoiceData.length; i++) {
    const d = br1InvoiceData[i];
    const taxable = d.amount * 0.9;
    const cgst = taxable * 0.06;
    await prisma.invoice.create({
      data: {
        invoiceNumber: `BR1-INV-${String(i + 1).padStart(4, '0')}`,
        date: daysAgo(d.days),
        type: InvoiceType.INVOICE,
        billingType: BillingType.RETAIL,
        branchId: br1.id,
        customerId: d.cust.id,
        customerName: d.cust.name,
        doctorId: doc2.id,
        doctorName: doc2.name,
        subtotal: d.amount,
        productDiscount: 0,
        taxableAmount: taxable,
        cgst: cgst,
        sgst: cgst,
        igst: 0,
        grandTotal: d.amount,
        paymentMode: d.mode,
        status: d.status,
        amountPaid: d.amountPaid,
        createdById: br1Pharmacist.id,
        items: {
          create: [{
            productId: d.product.id,
            productName: d.product.name,
            batchId: d.batch.id,
            batchNumber: d.batch.batchNumber,
            expiryDate: daysFromNow(365),
            quantity: d.qty,
            mrp: Number(d.product.mrp),
            rate: Number(d.product.sellingRate),
            discountPercent: 0,
            gstPercent: 12,
            amount: d.amount,
          }],
        },
      },
    });
  }

  // 5d. Credit Note → Chennai
  const firstBr1Inv = await prisma.invoice.findFirst({ where: { branchId: br1.id }, orderBy: { date: 'asc' } });
  if (firstBr1Inv) {
    await prisma.creditNote.create({
      data: {
        creditNoteNo: 'BR1-CN-0001',
        date: daysAgo(75),
        branchId: br1.id,
        invoiceId: firstBr1Inv.id,
        invoiceNumber: firstBr1Inv.invoiceNumber,
        customerId: cust2.id,
        customerName: cust2.name,
        reason: 'Product substitution requested by hospital pharmacy',
        subtotal: 22400,
        cgst: 1344,
        sgst: 1344,
        totalAmount: 25088,
        settlementMode: SettlementMode.CREDIT,
        createdById: br1Pharmacist.id,
        items: {
          create: [{
            productId: products[9].id,
            productName: products[9].name,
            batchId: br1Batch3.id,
            batchNumber: br1Batch3.batchNumber,
            expiryDate: daysFromNow(730),
            returnedQty: 1,
            rate: 23500,
            gstPercent: 12,
            amount: 25088,
          }],
        },
      },
    });
  }

  // 5e. Purchase Return → Chennai
  await prisma.purchaseReturn.create({
    data: {
      debitNoteNo: 'BR1-DN-0001',
      date: daysAgo(88),
      branchId: br1.id,
      grnId: br1GRN.id,
      supplierId: sup4.id,
      supplierName: sup4.name,
      reason: 'Cold chain breach detected — 2 Paclitaxel vials rejected',
      subtotal: 11600,
      cgst: 696,
      sgst: 696,
      totalAmount: 12992,
      status: PurchaseReturnStatus.SETTLED,
      createdById: br1Inventory.id,
      items: {
        create: [{
          productId: products[8].id,
          productName: products[8].name,
          batchId: br1Batch2.id,
          batchNumber: br1Batch2.batchNumber,
          expiryDate: daysFromNow(365),
          returnedQty: 2,
          purchaseRate: 5800,
          gstPercent: 12,
          amount: 12992,
        }],
      },
    },
  });

  // 5f. Expenses → Chennai
  await prisma.expense.createMany({
    data: [
      { date: daysAgo(70), branchId: br1.id, category: 'Rent', description: 'Feb Rent - Chennai', amount: 55000, paymentMode: 'BANK_TRANSFER' },
      { date: daysAgo(65), branchId: br1.id, category: 'Electricity', description: 'EB Bill - Feb', amount: 12000, paymentMode: 'BANK_TRANSFER' },
      { date: daysAgo(40), branchId: br1.id, category: 'Salary', description: 'Staff Salaries - March', amount: 110000, paymentMode: 'BANK_TRANSFER' },
      { date: daysAgo(35), branchId: br1.id, category: 'Rent', description: 'March Rent - Chennai', amount: 55000, paymentMode: 'BANK_TRANSFER' },
      { date: daysAgo(20), branchId: br1.id, category: 'Cold Storage', description: 'Refrigeration service', amount: 6500, paymentMode: 'CASH' },
      { date: daysAgo(12), branchId: br1.id, category: 'Electricity', description: 'EB Bill - March', amount: 14500, paymentMode: 'BANK_TRANSFER' },
      { date: daysAgo(6), branchId: br1.id, category: 'Transport', description: 'Delivery charges', amount: 5200, paymentMode: 'CASH' },
      { date: daysAgo(1), branchId: br1.id, category: 'Rent', description: 'April Rent - Chennai', amount: 55000, paymentMode: 'BANK_TRANSFER' },
    ],
  });

  console.log('  ✅ Chennai: 2 POs, 1 GRN, 10 invoices, 1 credit note, 1 purchase return, 8 expenses\n');

  // ── 6. UPDATE currentOutstanding from actual CREDIT/PARTIAL invoices ──────────
  console.log('💰 Updating customer outstanding balances...');
  const openInvoices = await prisma.invoice.findMany({
    where: { status: { in: ['CREDIT', 'PARTIAL'] } },
    select: { customerId: true, grandTotal: true, amountPaid: true },
  });
  const outstandingMap = new Map<string, number>();
  for (const inv of openInvoices) {
    if (!inv.customerId) continue;
    const unpaid = Number(inv.grandTotal) - Number(inv.amountPaid);
    outstandingMap.set(inv.customerId, (outstandingMap.get(inv.customerId) ?? 0) + unpaid);
  }
  await Promise.all(
    Array.from(outstandingMap.entries()).map(([customerId, amount]) =>
      prisma.customer.update({ where: { id: customerId }, data: { currentOutstanding: amount } })
    )
  );
  console.log(`  ✅ Updated ${outstandingMap.size} customers with outstanding balances\n`);

  // ── 7. SUMMARY ───────────────────────────────────────────────────────────────
  const [invCount, expCount, poCount, grnCount, cnCount, prCount] = await Promise.all([
    prisma.invoice.count(),
    prisma.expense.count(),
    prisma.purchaseOrder.count(),
    prisma.gRN.count(),
    prisma.creditNote.count(),
    prisma.purchaseReturn.count(),
  ]);

  console.log('═══════════════════════════════════════════════════════');
  console.log('✅  SEED COMPLETE — Multi-Branch Architecture');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('  BRANCHES   : 2  (HQ Madurai + Chennai)');
  console.log('  USERS      : 7  (1 Admin + 3 HQ + 3 Chennai)');
  console.log('  SUPPLIERS  : 5  (3 HQ + 2 Chennai)');
  console.log('  DOCTORS    : 3  (2 HQ + 1 Chennai)');
  console.log('  CUSTOMERS  : 7  (4 HQ + 3 Chennai)');
  console.log('  PRODUCTS   : 10 (6 HQ + 4 Chennai)');
  console.log(`  INVOICES   : ${invCount}  (${hqInvoiceData.length} HQ + ${br1InvoiceData.length} Chennai)`);
  console.log(`  EXPENSES   : ${expCount}  (8 HQ + 8 Chennai)`);
  console.log(`  POs        : ${poCount}  (1 HQ + 2 Chennai)`);
  console.log(`  GRNs       : ${grnCount}  (1 HQ + 1 Chennai)`);
  console.log(`  CREDIT NOTES: ${cnCount}  (1 HQ + 1 Chennai)`);
  console.log(`  DEBIT NOTES : ${prCount}  (1 HQ + 1 Chennai)`);
  console.log('');
  console.log('  LOGIN CREDENTIALS');
  console.log('  ─────────────────────────────────────────────────────');
  console.log('  admin@pbims.com           / admin123   → All branches');
  console.log('  pharmacist@pbims.com      / pharma123  → HQ only');
  console.log('  inventory@pbims.com       / stock123   → HQ only');
  console.log('  accountant@pbims.com      / account123 → HQ only');
  console.log('  pharmacist.chennai@pbims.com / pharma123 → Chennai only');
  console.log('  inventory.chennai@pbims.com  / stock123  → Chennai only');
  console.log('  accountant.chennai@pbims.com / account123 → Chennai only');
  console.log('═══════════════════════════════════════════════════════');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
