import { PrismaService } from '../prisma/prisma.service';
import { CreateGrnDto } from './dto/create-grn.dto';
export declare class GrnService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(createGrnDto: CreateGrnDto): Promise<{
        items: {
            id: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            purchaseRate: import("@prisma/client/runtime/library").Decimal;
            productId: string;
            batchNumber: string;
            mfgDate: Date;
            expiryDate: Date;
            productName: string;
            receivedQty: number;
            orderedQty: number;
            freeQty: number;
            damageQty: number;
            grnId: string;
        }[];
    } & {
        id: string;
        supplierId: string;
        date: Date;
        status: import(".prisma/client").$Enums.GRNStatus;
        supplierName: string;
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        poId: string | null;
        supplierInvoiceNo: string;
        supplierInvoiceDate: Date;
        supplierInvoiceAmount: import("@prisma/client/runtime/library").Decimal;
        grnNumber: string;
    }>;
    findAll(query?: string): import(".prisma/client").Prisma.PrismaPromise<{
        id: string;
        supplierId: string;
        date: Date;
        status: import(".prisma/client").$Enums.GRNStatus;
        supplierName: string;
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        poId: string | null;
        supplierInvoiceNo: string;
        supplierInvoiceDate: Date;
        supplierInvoiceAmount: import("@prisma/client/runtime/library").Decimal;
        grnNumber: string;
    }[]>;
    findOne(id: string): Promise<{
        items: {
            id: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            purchaseRate: import("@prisma/client/runtime/library").Decimal;
            productId: string;
            batchNumber: string;
            mfgDate: Date;
            expiryDate: Date;
            productName: string;
            receivedQty: number;
            orderedQty: number;
            freeQty: number;
            damageQty: number;
            grnId: string;
        }[];
    } & {
        id: string;
        supplierId: string;
        date: Date;
        status: import(".prisma/client").$Enums.GRNStatus;
        supplierName: string;
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        poId: string | null;
        supplierInvoiceNo: string;
        supplierInvoiceDate: Date;
        supplierInvoiceAmount: import("@prisma/client/runtime/library").Decimal;
        grnNumber: string;
    }>;
}
