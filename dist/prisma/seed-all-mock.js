"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const mock_1 = require("./mock");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Seeding all mock data to the database...');
    for (const user of mock_1.mockUsers) {
        await prisma.user.upsert({
            where: { email: user.email },
            update: {},
            create: {
                name: user.name,
                email: user.email,
                phone: user.phone,
                password: user.password,
                role: user.role.toUpperCase(),
                isActive: user.isActive,
            },
        });
    }
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
                paymentTerms: sup.paymentTerms,
            },
        });
    }
    for (const customer of mock_1.mockCustomers) {
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
                type: customer.type.toUpperCase(),
                creditLimit: customer.creditLimit,
                currentOutstanding: customer.currentOutstanding,
                loyaltyPoints: customer.loyaltyPoints,
                gstin: customer.gstin,
                dlNumber: customer.dlNumber,
                notes: customer.notes,
            },
        });
    }
    for (const prod of mock_1.mockProducts) {
        await prisma.product.upsert({
            where: { id: prod.id },
            update: {},
            create: {
                id: prod.id,
                name: prod.name,
                genericName: prod.genericName,
                manufacturer: prod.manufacturer,
                category: (prod.category.toUpperCase() === 'NEPHROLOGY' || prod.category.toUpperCase() === 'ONCOLOGY' || prod.category.toUpperCase() === 'GENERAL' || prod.category.toUpperCase() === 'OTC' || prod.category.toUpperCase() === 'SURGICAL')
                    ? prod.category.toUpperCase()
                    : 'GENERAL',
                subCategory: prod.subCategory,
                packSize: prod.packSize,
                unitOfMeasure: prod.unitOfMeasure,
                schedule: (prod.schedule && (prod.schedule === 'H' || prod.schedule === 'H1' || prod.schedule === 'X'))
                    ? prod.schedule
                    : 'NONE',
                hsnCode: prod.hsnCode,
                isNarcotic: prod.isNarcotic,
                storageCondition: prod.storageCondition.toUpperCase(),
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
    for (const batch of mock_1.mockBatches) {
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
//# sourceMappingURL=seed-all-mock.js.map