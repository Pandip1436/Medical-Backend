import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
export declare class SuppliersController {
    private readonly suppliersService;
    constructor(suppliersService: SuppliersService);
    create(createSupplierDto: CreateSupplierDto): import(".prisma/client").Prisma.Prisma__SupplierClient<{
        id: string;
        email: string;
        name: string;
        phone: string;
        isActive: boolean;
        address: string;
        contactPerson: string;
        gstin: string;
        drugLicense: string;
        paymentTerms: import(".prisma/client").$Enums.PaymentTerms;
        bankDetails: string | null;
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    findAll(q?: string): import(".prisma/client").Prisma.PrismaPromise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        isActive: boolean;
        address: string;
        contactPerson: string;
        gstin: string;
        drugLicense: string;
        paymentTerms: import(".prisma/client").$Enums.PaymentTerms;
        bankDetails: string | null;
    }[]>;
    findOne(id: string): Promise<{
        batches: {
            id: string;
            createdAt: Date;
            mrp: import("@prisma/client/runtime/library").Decimal;
            purchaseRate: import("@prisma/client/runtime/library").Decimal;
            productId: string;
            batchNumber: string;
            mfgDate: Date;
            expiryDate: Date;
            quantity: number;
            supplierId: string;
        }[];
        purchaseOrders: {
            id: string;
            supplierId: string;
            date: Date;
            status: import(".prisma/client").$Enums.POStatus;
            createdBy: string;
            poNumber: string;
            supplierName: string;
            totalAmount: import("@prisma/client/runtime/library").Decimal;
            expectedDelivery: Date | null;
        }[];
    } & {
        id: string;
        email: string;
        name: string;
        phone: string;
        isActive: boolean;
        address: string;
        contactPerson: string;
        gstin: string;
        drugLicense: string;
        paymentTerms: import(".prisma/client").$Enums.PaymentTerms;
        bankDetails: string | null;
    }>;
    update(id: string, updateSupplierDto: UpdateSupplierDto): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        isActive: boolean;
        address: string;
        contactPerson: string;
        gstin: string;
        drugLicense: string;
        paymentTerms: import(".prisma/client").$Enums.PaymentTerms;
        bankDetails: string | null;
    }>;
    remove(id: string): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        isActive: boolean;
        address: string;
        contactPerson: string;
        gstin: string;
        drugLicense: string;
        paymentTerms: import(".prisma/client").$Enums.PaymentTerms;
        bankDetails: string | null;
    }>;
}
