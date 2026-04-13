import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
export declare class PurchaseOrdersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(createPurchaseOrderDto: CreatePurchaseOrderDto, userId: string): Promise<{
        items: {
            id: string;
            productId: string;
            productName: string;
            requiredQty: number;
            lastPurchaseRate: import("@prisma/client/runtime/library").Decimal;
            expectedRate: import("@prisma/client/runtime/library").Decimal;
            remarks: string | null;
            receivedQty: number;
            purchaseOrderId: string;
        }[];
    } & {
        id: string;
        supplierId: string;
        date: Date;
        status: import(".prisma/client").$Enums.POStatus;
        createdBy: string;
        supplierName: string;
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        expectedDelivery: Date | null;
        poNumber: string;
    }>;
    findAll(query?: string): import(".prisma/client").Prisma.PrismaPromise<{
        id: string;
        supplierId: string;
        date: Date;
        status: import(".prisma/client").$Enums.POStatus;
        createdBy: string;
        supplierName: string;
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        expectedDelivery: Date | null;
        poNumber: string;
    }[]>;
    findOne(id: string): Promise<{
        items: {
            id: string;
            productId: string;
            productName: string;
            requiredQty: number;
            lastPurchaseRate: import("@prisma/client/runtime/library").Decimal;
            expectedRate: import("@prisma/client/runtime/library").Decimal;
            remarks: string | null;
            receivedQty: number;
            purchaseOrderId: string;
        }[];
    } & {
        id: string;
        supplierId: string;
        date: Date;
        status: import(".prisma/client").$Enums.POStatus;
        createdBy: string;
        supplierName: string;
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        expectedDelivery: Date | null;
        poNumber: string;
    }>;
    update(id: string, updatePurchaseOrderDto: UpdatePurchaseOrderDto): Promise<{
        items: {
            id: string;
            productId: string;
            productName: string;
            requiredQty: number;
            lastPurchaseRate: import("@prisma/client/runtime/library").Decimal;
            expectedRate: import("@prisma/client/runtime/library").Decimal;
            remarks: string | null;
            receivedQty: number;
            purchaseOrderId: string;
        }[];
    } & {
        id: string;
        supplierId: string;
        date: Date;
        status: import(".prisma/client").$Enums.POStatus;
        createdBy: string;
        supplierName: string;
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        expectedDelivery: Date | null;
        poNumber: string;
    }>;
    remove(id: string): Promise<{
        id: string;
        supplierId: string;
        date: Date;
        status: import(".prisma/client").$Enums.POStatus;
        createdBy: string;
        supplierName: string;
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        expectedDelivery: Date | null;
        poNumber: string;
    }>;
}
