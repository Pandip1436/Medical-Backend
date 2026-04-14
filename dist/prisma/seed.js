"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcrypt"));
const dayjs_1 = __importDefault(require("dayjs"));
const prisma = new client_1.PrismaClient();
const demoUsers = [
    {
        name: 'Super Admin',
        email: 'admin@pbims.com',
        phone: '9000000001',
        password: 'admin123',
        role: client_1.Role.ADMIN,
    },
    {
        name: 'Ravi Kumar',
        email: 'pharmacist@pbims.com',
        phone: '9000000002',
        password: 'pharma123',
        role: client_1.Role.PHARMACIST,
    },
    {
        name: 'Kumar Singh',
        email: 'inventory@pbims.com',
        phone: '9000000003',
        password: 'stock123',
        role: client_1.Role.INVENTORY_MANAGER,
    },
    {
        name: 'Priya Sharma',
        email: 'accountant@pbims.com',
        phone: '9000000004',
        password: 'account123',
        role: client_1.Role.ACCOUNTANT,
    },
];
async function main() {
    console.log('🌱 Seeding demo users...');
    let adminUser = null;
    for (const user of demoUsers) {
        const existing = await prisma.user.findUnique({ where: { email: user.email } });
        if (!existing) {
            const hashedPassword = await bcrypt.hash(user.password, 10);
            const createdUser = await prisma.user.create({
                data: {
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    password: hashedPassword,
                    role: user.role,
                },
            });
            console.log(`✅ Created [${user.role}]: ${user.email} / ${user.password}`);
            if (user.role === client_1.Role.ADMIN)
                adminUser = createdUser;
        }
        else {
            console.log(`⏭️  Already exists: ${user.email}`);
            if (user.role === client_1.Role.ADMIN)
                adminUser = existing;
        }
    }
    const suppliers = await Promise.all([
        prisma.supplier.upsert({
            where: { id: 'supp_1' },
            update: {},
            create: {
                id: 'supp_1', name: 'Alkem Laboratories', contactPerson: 'Mr. Sharma',
                phone: '9876543210', email: 'vapi@alkem.com', gstin: '24AAAAA0000A1Z5',
                drugLicense: 'DL-12345', address: 'Mumbai, India', paymentTerms: client_1.PaymentTerms.NET_30
            }
        }),
        prisma.supplier.upsert({
            where: { id: 'supp_2' },
            update: {},
            create: {
                id: 'supp_2', name: 'Cipla Ltd', contactPerson: 'Mr. Gupta',
                phone: '9876543211', email: 'sales@cipla.com', gstin: '27AAAAA0001A1Z5',
                drugLicense: 'DL-67890', address: 'Pune, India', paymentTerms: client_1.PaymentTerms.NET_45
            }
        })
    ]);
    const categories = [client_1.ProductCategory.ONCOLOGY, client_1.ProductCategory.NEPHROLOGY, client_1.ProductCategory.GENERAL, client_1.ProductCategory.OTC];
    const productData = [
        { name: 'Rituximab 500mg', generic: 'Rituximab', cat: client_1.ProductCategory.ONCOLOGY, price: 23500 },
        { name: 'Bevacizumab 400mg', generic: 'Bevacizumab', cat: client_1.ProductCategory.ONCOLOGY, price: 20500 },
        { name: 'Tacrolimus 1mg', generic: 'Tacrolimus', cat: client_1.ProductCategory.NEPHROLOGY, price: 295 },
        { name: 'Furosemide 40mg', generic: 'Furosemide', cat: client_1.ProductCategory.GENERAL, price: 15 },
        { name: 'Paracetamol 650mg', generic: 'Paracetamol', cat: client_1.ProductCategory.OTC, price: 30 }
    ];
    const products = await Promise.all(productData.map((p, i) => prisma.product.upsert({
        where: { id: `prod_${i}` },
        update: {},
        create: {
            id: `prod_${i}`, name: p.name, genericName: p.generic, manufacturer: 'PharmaCorp',
            category: p.cat, packSize: '10s', unitOfMeasure: 'Box', hsnCode: '3004',
            storageCondition: client_1.StorageCondition.ROOM_TEMP, mrp: p.price, purchaseRate: p.price * 0.7,
            sellingRate: p.price * 0.95, wholesaleRate: p.price * 0.85, gstRate: 12,
            minStock: 10, maxStock: 100, reorderQty: 20, rackLocation: 'A-1'
        }
    })));
    await Promise.all(products.map((p, i) => prisma.batch.create({
        data: {
            productId: p.id, batchNumber: `BATCH-00${i}`, mfgDate: (0, dayjs_1.default)().subtract(3, 'months').toDate(),
            expiryDate: (0, dayjs_1.default)().add(12, 'months').toDate(), quantity: 50, mrp: p.mrp,
            purchaseRate: p.purchaseRate, supplierId: suppliers[i % 2].id
        }
    })));
    const customers = await prisma.customer.findMany({ take: 3 });
    if (customers.length > 0) {
        for (let i = 0; i < 15; i++) {
            const date = (0, dayjs_1.default)().startOf('day').add(9 + Math.floor(i * 0.8), 'hour').toDate();
            const amount = Math.floor(Math.random() * 10000) + 1000;
            await prisma.invoice.create({
                data: {
                    invoiceNumber: `INV-${Date.now()}-${i}`,
                    date: date,
                    type: client_1.InvoiceType.INVOICE,
                    billingType: client_1.BillingType.RETAIL,
                    customerId: customers[0].id,
                    customerName: customers[0].name,
                    grandTotal: amount,
                    subtotal: amount * 0.9,
                    taxableAmount: amount * 0.8,
                    cgst: amount * 0.06,
                    sgst: amount * 0.06,
                    paymentMode: client_1.PaymentMode.CASH,
                    status: client_1.InvoiceStatus.PAID,
                    amountPaid: amount,
                    createdById: adminUser.id
                }
            });
        }
    }
    console.log('✅ Database seeded successfully');
}
main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
//# sourceMappingURL=seed.js.map