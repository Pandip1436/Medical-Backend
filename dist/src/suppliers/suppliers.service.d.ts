import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
export declare class SuppliersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(createSupplierDto: CreateSupplierDto & {
        branchId?: string;
    }): import(".prisma/client").Prisma.Prisma__SupplierClient<{
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
        currentOutstanding: import("@prisma/client/runtime/library").Decimal;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    findAll(query?: string, branchId?: string): import(".prisma/client").Prisma.PrismaPromise<{
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
        currentOutstanding: import("@prisma/client/runtime/library").Decimal;
    }[]>;
    findOne(id: string, branchId?: string): Promise<{
        purchaseOrders: {
            id: string;
            branchId: string | null;
            date: Date;
            supplierId: string;
            supplierName: string;
            totalAmount: import("@prisma/client/runtime/library").Decimal;
            status: import(".prisma/client").$Enums.POStatus;
            poNumber: string;
            expectedDelivery: Date | null;
            createdBy: string;
        }[];
        batches: {
            id: string;
            createdAt: Date;
            supplierId: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            purchaseRate: import("@prisma/client/runtime/library").Decimal;
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
        currentOutstanding: import("@prisma/client/runtime/library").Decimal;
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
        currentOutstanding: import("@prisma/client/runtime/library").Decimal;
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
        currentOutstanding: import("@prisma/client/runtime/library").Decimal;
    }>;
}
