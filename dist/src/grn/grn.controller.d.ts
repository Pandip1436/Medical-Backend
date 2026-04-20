import { GrnService } from './grn.service';
import { CreateGrnDto } from './dto/create-grn.dto';
export declare class GrnController {
    private readonly grnService;
    constructor(grnService: GrnService);
    create(createGrnDto: CreateGrnDto, req: any): Promise<{
        items: {
            id: string;
            grnId: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            purchaseRate: import("@prisma/client/runtime/library").Decimal;
            productId: string;
            productName: string;
            receivedQty: number;
            orderedQty: number;
            freeQty: number;
            batchNumber: string;
            mfgDate: Date;
            expiryDate: Date;
            damageQty: number;
        }[];
    } & {
        id: string;
        branchId: string | null;
        date: Date;
        supplierId: string;
        supplierName: string;
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.GRNStatus;
        grnNumber: string;
        poId: string | null;
        supplierInvoiceNo: string;
        supplierInvoiceDate: Date;
        supplierInvoiceAmount: import("@prisma/client/runtime/library").Decimal;
    }>;
    findAll(req: any, q?: string, branchId?: string): import(".prisma/client").Prisma.PrismaPromise<({
        items: {
            id: string;
            grnId: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            purchaseRate: import("@prisma/client/runtime/library").Decimal;
            productId: string;
            productName: string;
            receivedQty: number;
            orderedQty: number;
            freeQty: number;
            batchNumber: string;
            mfgDate: Date;
            expiryDate: Date;
            damageQty: number;
        }[];
    } & {
        id: string;
        branchId: string | null;
        date: Date;
        supplierId: string;
        supplierName: string;
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.GRNStatus;
        grnNumber: string;
        poId: string | null;
        supplierInvoiceNo: string;
        supplierInvoiceDate: Date;
        supplierInvoiceAmount: import("@prisma/client/runtime/library").Decimal;
    })[]>;
    findOne(id: string, req: any): Promise<{
        items: {
            id: string;
            grnId: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            purchaseRate: import("@prisma/client/runtime/library").Decimal;
            productId: string;
            productName: string;
            receivedQty: number;
            orderedQty: number;
            freeQty: number;
            batchNumber: string;
            mfgDate: Date;
            expiryDate: Date;
            damageQty: number;
        }[];
    } & {
        id: string;
        branchId: string | null;
        date: Date;
        supplierId: string;
        supplierName: string;
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.GRNStatus;
        grnNumber: string;
        poId: string | null;
        supplierInvoiceNo: string;
        supplierInvoiceDate: Date;
        supplierInvoiceAmount: import("@prisma/client/runtime/library").Decimal;
    }>;
}
