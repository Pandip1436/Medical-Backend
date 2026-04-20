import { PrismaService } from '../prisma/prisma.service';
import { CreateGrnDto } from './dto/create-grn.dto';
export declare class GrnService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(createGrnDto: CreateGrnDto, branchId?: string): Promise<{
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
    findAll(query?: string, branchId?: string): import(".prisma/client").Prisma.PrismaPromise<({
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
    findOne(id: string, branchId?: string): Promise<{
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
