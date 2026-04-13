const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const mockUsers = [
  { name: 'Admin', email: 'admin@hospitalsuppliers.com', phone: '9876543210', role: 'ADMIN', password: 'Admin@123', isActive: true },
  { name: 'Ravi Shankar', email: 'ravi@hospitalsuppliers.com', phone: '9876543211', role: 'PHARMACIST', password: 'Pharma@123', isActive: true },
  { name: 'Kumar Selvam', email: 'kumar@hospitalsuppliers.com', phone: '9876543212', role: 'INVENTORY_MANAGER', password: 'Stock@123', isActive: true },
  { name: 'Priya Lakshmi', email: 'priya@hospitalsuppliers.com', phone: '9876543213', role: 'ACCOUNTANT', password: 'Account@123', isActive: true },
];

const mockSuppliers = [
  { id: 'SUP-001', name: 'Cipla Ltd', contactPerson: 'Arun Menon', phone: '9876001001', email: 'supply.south@cipla.com', gstin: '27AABCC1234A1Z5', drugLicense: 'MH/MUM/20B/2020/0001', address: 'Cipla House, peninsula Business Park, Mumbai - 400013', paymentTerms: 'NET_30' },
  { id: 'SUP-002', name: "Dr. Reddy's Laboratories", contactPerson: 'Sunil Reddy', phone: '9876002002', email: 'dist.tn@drreddys.com', gstin: '36AABCD5678B2Z1', drugLicense: 'TS/HYD/20B/2019/0342', address: '8-2-337, Road No. 3, Banjara Hills, Hyderabad - 500034', paymentTerms: 'NET_45' },
  { id: 'SUP-003', name: 'Sun Pharmaceutical', contactPerson: 'Deepak Sharma', phone: '9876003003', email: 'orders.south@sunpharma.com', gstin: '24AABCE9012C3Z7', drugLicense: 'GJ/AHM/20B/2021/0567', address: 'Sun House, CG Road, Ahmedabad - 380006', paymentTerms: 'NET_30' },
  { id: 'SUP-004', name: 'Natco Pharma', contactPerson: 'Venkat Rao', phone: '9876004004', email: 'supply@natcopharma.co.in', gstin: '36AABCF3456D4Z3', drugLicense: 'TS/HYD/20B/2020/0891', address: 'Natco House, Road No. 2, Banjara Hills, Hyderabad - 500034', paymentTerms: 'NET_45' },
  { id: 'SUP-005', name: 'Hetero Drugs', contactPerson: 'Raman Iyer', phone: '9876005005', email: 'distribution@heterodrugs.com', gstin: '36AABCG7890E5Z9', drugLicense: 'TS/HYD/20B/2021/1023', address: 'Hetero Corporate, ISB Road, Hyderabad - 500032', paymentTerms: 'NET_60' },
];

const mockCustomers = [
  { id: 'CUS-001', name: 'Apollo Hospital - Madurai', phone: '9944112233', email: 'pharmacy@apollomadurai.com', address: '11, KK Nagar, Madurai - 625020', type: 'HOSPITAL', creditLimit: 500000, currentOutstanding: 185400, gstin: '33AABCA1234A1Z5', dlNumber: 'TN/MDU/20B/2021/1001' },
  { id: 'CUS-002', name: 'MIOT Hospital', phone: '9944223344', email: 'purchase@miothospitals.com', address: '4/112, Mount Poonamallee Road, Chennai - 600089', type: 'HOSPITAL', creditLimit: 750000, currentOutstanding: 342500, gstin: '33AABCM5678B2Z1', dlNumber: 'TN/CHE/20B/2020/0852' },
  { id: 'CUS-003', name: 'Meenakshi Mission Hospital', phone: '9944334455', email: 'stores@meenakshimission.com', address: 'Lake Area, Melur Road, Madurai - 625107', type: 'HOSPITAL', creditLimit: 600000, currentOutstanding: 98700, gstin: '33AABCN9012C3Z7', dlNumber: 'TN/MDU/20B/2019/0743' },
  { id: 'CUS-004', name: 'MedPlus - Madurai', phone: '9944445566', email: 'madurai@medplus.in', address: '45, Anna Nagar, Madurai - 625020', type: 'WHOLESALE', creditLimit: 300000, currentOutstanding: 67800 },
  { id: 'CUS-005', name: 'PharmEasy Wholesale', phone: '9944556677', email: 'procurement@pharmeasy.in', address: '89, Industrial Area, Sivagangai Road, Madurai - 625003', type: 'WHOLESALE', creditLimit: 400000, currentOutstanding: 125600 },
  { id: 'CUS-006', name: 'Murugan S', phone: '9944667788', address: '12/3, Simmakkal, Madurai - 625001', type: 'REGULAR', creditLimit: 10000, currentOutstanding: 2400 },
  { id: 'CUS-007', name: 'Lakshmi K', phone: '9944778899', address: '56, Tallakulam, Madurai - 625002', type: 'REGULAR', creditLimit: 15000, currentOutstanding: 8750 },
  { id: 'CUS-008', name: 'Rajesh Kumar P', phone: '9944889900', address: '78, Villapuram, Madurai - 625012', type: 'REGULAR', creditLimit: 20000, currentOutstanding: 0 },
  { id: 'CUS-010', name: 'Walk-in Customer', phone: '0000000000', type: 'WALK_IN', creditLimit: 0, currentOutstanding: 0 },
  { id: 'CUS-011', name: 'Dr. Balaji Clinic', phone: '9944101112', email: 'drbalaji.nephro@gmail.com', address: '99, Goripalayam, Madurai - 625002', type: 'DOCTOR', creditLimit: 100000, currentOutstanding: 31200 },
];

const mockProducts = [
  { id: 'PRD-001', name: 'Torsemide 20mg Tab', genericName: 'Torsemide', manufacturer: 'Cipla Ltd', category: 'NEPHROLOGY', mrp: 85.0, purchaseRate: 52.0, sellingRate: 78.0, wholesaleRate: 68.0, gstRate: 12, totalStock: 450, packSize: '10x10', unitOfMeasure: 'Strip', schedule: 'H', storageCondition: 'ROOM_TEMP', hsnCode: '30049099' },
  { id: 'PRD-002', name: 'Erythropoietin 4000IU Inj', genericName: 'Epoetin Alfa', manufacturer: "Dr. Reddy's Laboratories", category: 'NEPHROLOGY', mrp: 1250.0, purchaseRate: 850.0, sellingRate: 1150.0, wholesaleRate: 1020.0, gstRate: 12, totalStock: 65, packSize: '1 Vial', unitOfMeasure: 'Vial', schedule: 'H', storageCondition: 'REFRIGERATED', hsnCode: '30021200' },
  { id: 'PRD-003', name: 'Ondansetron 4mg Tab', genericName: 'Ondansetron', manufacturer: 'Sun Pharmaceutical', category: 'ONCOLOGY', mrp: 62.5, purchaseRate: 38.0, sellingRate: 56.0, wholesaleRate: 48.0, gstRate: 12, totalStock: 820, packSize: '10x10', unitOfMeasure: 'Strip', schedule: 'H', storageCondition: 'ROOM_TEMP', hsnCode: '30049099' },
  { id: 'PRD-004', name: 'Tacrolimus 1mg Cap', genericName: 'Tacrolimus', manufacturer: 'Hetero Drugs', category: 'NEPHROLOGY', mrp: 320.0, purchaseRate: 210.0, sellingRate: 295.0, wholesaleRate: 260.0, gstRate: 12, totalStock: 38, packSize: '10x6', unitOfMeasure: 'Strip', schedule: 'H1', storageCondition: 'COOL_DRY', hsnCode: '30049099' },
  { id: 'PRD-012', name: 'Losartan 50mg Tab', genericName: 'Losartan Potassium', manufacturer: 'Cipla Ltd', category: 'NEPHROLOGY', mrp: 68.0, purchaseRate: 40.0, sellingRate: 62.0, wholesaleRate: 54.0, gstRate: 12, totalStock: 1250, packSize: '10x10', unitOfMeasure: 'Strip', schedule: 'H', storageCondition: 'ROOM_TEMP', hsnCode: '30049099' },
  { id: 'PRD-014', name: 'Furosemide 40mg Tab', genericName: 'Furosemide', manufacturer: 'Cipla Ltd', category: 'NEPHROLOGY', mrp: 28.0, purchaseRate: 16.0, sellingRate: 25.0, wholesaleRate: 22.0, gstRate: 12, totalStock: 1800, packSize: '10x15', unitOfMeasure: 'Strip', schedule: 'H', storageCondition: 'ROOM_TEMP', hsnCode: '30049099' },
];

const mockBatches = [
  { id: 'BAT-001', productId: 'PRD-001', batchNumber: 'TOR2401A', mfgDate: '2024-08-01', expiryDate: '2026-07-31', quantity: 200, mrp: 85.0, purchaseRate: 52.0, supplierId: 'SUP-001' },
  { id: 'BAT-002', productId: 'PRD-001', batchNumber: 'TOR2502B', mfgDate: '2025-06-01', expiryDate: '2027-05-31', quantity: 250, mrp: 85.0, purchaseRate: 52.0, supplierId: 'SUP-001' },
  { id: 'BAT-023', productId: 'PRD-012', batchNumber: 'LOS2404W', mfgDate: '2024-04-01', expiryDate: '2026-09-30', quantity: 450, mrp: 68.0, purchaseRate: 40.0, supplierId: 'SUP-001' },
];

async function main() {
  console.log('Seeding all mock data...');
  
  for (const user of mockUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: user,
      create: user,
    });
  }

  for (const sup of mockSuppliers) {
    await prisma.supplier.upsert({
      where: { id: sup.id },
      update: sup,
      create: sup,
    });
  }

  for (const customer of mockCustomers) {
    await prisma.customer.upsert({
      where: { id: customer.id },
      update: customer,
      create: customer,
    });
  }

  for (const prod of mockProducts) {
    await prisma.product.upsert({
      where: { id: prod.id },
      update: { ...prod, alternatives: undefined, alternativesOf: undefined },
      create: { ...prod, alternatives: undefined, alternativesOf: undefined, minStock:0, maxStock:1000, reorderQty:100, rackLocation:'temp' },
    });
  }

  for (const batch of mockBatches) {
    await prisma.batch.upsert({
      where: { id: batch.id },
      update: {
        ...batch,
        mfgDate: new Date(batch.mfgDate),
        expiryDate: new Date(batch.expiryDate),
      },
      create: {
        ...batch,
        mfgDate: new Date(batch.mfgDate),
        expiryDate: new Date(batch.expiryDate),
      },
    });
  }

  console.log('✅ Seeding complete!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
