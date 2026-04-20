import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
export declare class SuppliersController {
    private readonly suppliersService;
    constructor(suppliersService: SuppliersService);
    create(createSupplierDto: CreateSupplierDto, req: any, qBranchId?: string): import(".prisma/client").Prisma.Prisma__SupplierClient<{
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
    }, never, import("@prisma/client/runtime/library").DefaultArgs>;
    findAll(req: any, q?: string, branchId?: string): import(".prisma/client").Prisma.PrismaPromise<{
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
    }[]>;
    findOne(id: string, req: any): Promise<{
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
    }>;
    update(id: string, updateSupplierDto: UpdateSupplierDto, req: any): Promise<{
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
    }>;
    remove(id: string, req: any): Promise<{
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
    }>;
}
