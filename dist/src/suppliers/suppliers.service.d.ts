import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
export declare class SuppliersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    private normalizePhone;
    private assertNoDuplicate;
    create(createSupplierDto: CreateSupplierDto & {
        branchId?: string;
    }): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        isActive: boolean;
        branchId: string | null;
        address: string;
        gstin: string;
        drugLicense: string;
        contactPerson: string;
        paymentTerms: import(".prisma/client").$Enums.PaymentTerms;
        bankDetails: string | null;
        currentOutstanding: Prisma.Decimal;
    }>;
    bulkCreate(suppliers: CreateSupplierDto[], branchId?: string): Promise<{
        createdCount: number;
        skippedCount: number;
        errors: string[];
    }>;
    findAll(query?: string, branchId?: string): Prisma.PrismaPromise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        isActive: boolean;
        branchId: string | null;
        address: string;
        gstin: string;
        drugLicense: string;
        contactPerson: string;
        paymentTerms: import(".prisma/client").$Enums.PaymentTerms;
        bankDetails: string | null;
        currentOutstanding: Prisma.Decimal;
    }[]>;
    findOne(id: string, branchId?: string): Promise<{
        purchaseOrders: {
            id: string;
            branchId: string | null;
            date: Date;
            supplierId: string;
            supplierName: string;
            totalAmount: Prisma.Decimal;
            status: import(".prisma/client").$Enums.POStatus;
            poNumber: string;
            expectedDelivery: Date | null;
            createdBy: string;
        }[];
        batches: {
            id: string;
            createdAt: Date;
            supplierId: string;
            mrp: Prisma.Decimal;
            purchaseRate: Prisma.Decimal;
            productId: string;
            batchNumber: string;
            mfgDate: Date;
            expiryDate: Date;
            quantity: number;
        }[];
    } & {
        id: string;
        email: string;
        name: string;
        phone: string;
        isActive: boolean;
        branchId: string | null;
        address: string;
        gstin: string;
        drugLicense: string;
        contactPerson: string;
        paymentTerms: import(".prisma/client").$Enums.PaymentTerms;
        bankDetails: string | null;
        currentOutstanding: Prisma.Decimal;
    }>;
    update(id: string, updateSupplierDto: UpdateSupplierDto, branchId?: string): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        isActive: boolean;
        branchId: string | null;
        address: string;
        gstin: string;
        drugLicense: string;
        contactPerson: string;
        paymentTerms: import(".prisma/client").$Enums.PaymentTerms;
        bankDetails: string | null;
        currentOutstanding: Prisma.Decimal;
    }>;
    remove(id: string, branchId?: string): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        isActive: boolean;
        branchId: string | null;
        address: string;
        gstin: string;
        drugLicense: string;
        contactPerson: string;
        paymentTerms: import(".prisma/client").$Enums.PaymentTerms;
        bankDetails: string | null;
        currentOutstanding: Prisma.Decimal;
    }>;
}
