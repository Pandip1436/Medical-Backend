"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Seeding initial inventory for testing...');
    const s1 = await prisma.supplier.create({
        data: {
            name: 'Global Pharma Distributors',
            contactPerson: 'Mr. Sharma',
            phone: '9876543211',
            email: 'sales@globalpharma.com',
            address: 'Industrial Area',
            gstin: '29ABCDE1234F1Z5',
            drugLicense: 'DL-12345',
            paymentTerms: 'NET_30',
            bankDetails: 'HDFC BANK - 50100123456789'
        }
    });
    const c1 = await prisma.customer.create({
        data: {
            name: 'City General Hospital',
            phone: '9876543210',
            email: 'pharmacy@citygeneral.com',
            type: 'HOSPITAL',
            address: '123 Health Ave, Medical Dist',
            creditLimit: 500000,
            currentOutstanding: 125000,
        }
    });
    const p1 = await prisma.product.create({
        data: {
            name: 'Augmentin 625 Duo Tablet',
            genericName: 'Amoxicillin + Clavulanic Acid',
            hsnCode: '30049099',
            manufacturer: 'GlaxoSmithKline',
            category: 'GENERAL',
            schedule: 'H1',
            packSize: '10 Tablets/Strip',
            unitOfMeasure: 'STRIP',
            storageCondition: 'ROOM_TEMP',
            mrp: 201.50,
            purchaseRate: 145.00,
            sellingRate: 185.00,
            wholesaleRate: 160.00,
            gstRate: 12,
            minStock: 50,
            maxStock: 500,
            reorderQty: 100,
            rackLocation: 'A-1-4',
            totalStock: 120,
        }
    });
    await prisma.batch.create({
        data: {
            productId: p1.id,
            supplierId: s1.id,
            batchNumber: 'GSK-A625-M24',
            mfgDate: new Date('2023-11-01'),
            expiryDate: new Date('2025-10-31'),
            quantity: 120,
            mrp: 201.50,
            purchaseRate: 145.00
        }
    });
    const p2 = await prisma.product.create({
        data: {
            name: 'Dolo 650 Tablet',
            genericName: 'Paracetamol',
            hsnCode: '30049099',
            manufacturer: 'Micro Labs',
            category: 'GENERAL',
            schedule: 'NONE',
            packSize: '15 Tablets/Strip',
            unitOfMeasure: 'STRIP',
            storageCondition: 'ROOM_TEMP',
            mrp: 33.00,
            purchaseRate: 20.00,
            sellingRate: 30.00,
            wholesaleRate: 25.00,
            gstRate: 12,
            minStock: 200,
            maxStock: 2000,
            reorderQty: 500,
            rackLocation: 'B-2-1',
            totalStock: 850,
        }
    });
    await prisma.batch.create({
        data: {
            productId: p2.id,
            supplierId: s1.id,
            batchNumber: 'ML-D650-88K',
            mfgDate: new Date('2024-01-15'),
            expiryDate: new Date('2027-01-14'),
            quantity: 850,
            mrp: 33.00,
            purchaseRate: 20.00
        }
    });
    console.log('✅ Inventory Seeding Complete! Enjoy testing the Billing screen.');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed-inventory.js.map