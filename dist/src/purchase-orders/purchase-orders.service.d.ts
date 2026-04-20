import { PrismaService } from '../prisma/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
export declare class PurchaseOrdersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(createPurchaseOrderDto: CreatePurchaseOrderDto, userId: string, branchId?: string): Promise<{
        items: {
            id: string;
            productId: string;
            productName: string;
            requiredQty: number;
            lastPurchaseRate: import("@prisma/client/runtime/library").Decimal;
            expectedRate: import("@prisma/client/runtime/library").Decimal;
            receivedQty: number;
            remarks: string | null;
            purchaseOrderId: string;
        }[];
    } & {
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
    }>;
    findAll(query?: string, branchId?: string): import(".prisma/client").Prisma.PrismaPromise<({
        items: {
            id: string;
            productId: string;
            productName: string;
            requiredQty: number;
            lastPurchaseRate: import("@prisma/client/runtime/library").Decimal;
            expectedRate: import("@prisma/client/runtime/library").Decimal;
            receivedQty: number;
            remarks: string | null;
            purchaseOrderId: string;
        }[];
    } & {
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
    })[]>;
    findOne(id: string, branchId?: string): Promise<{
        items: {
            id: string;
            productId: string;
            productName: string;
            requiredQty: number;
            lastPurchaseRate: import("@prisma/client/runtime/library").Decimal;
            expectedRate: import("@prisma/client/runtime/library").Decimal;
            receivedQty: number;
            remarks: string | null;
            purchaseOrderId: string;
        }[];
    } & {
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
    }>;
    update(id: string, updatePurchaseOrderDto: UpdatePurchaseOrderDto, branchId?: string): Promise<{
        items: {
            id: string;
            productId: string;
            productName: string;
            requiredQty: number;
            lastPurchaseRate: import("@prisma/client/runtime/library").Decimal;
            expectedRate: import("@prisma/client/runtime/library").Decimal;
            receivedQty: number;
            remarks: string | null;
            purchaseOrderId: string;
        }[];
    } & {
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
    }>;
    remove(id: string, branchId?: string): Promise<{
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
    }>;
}
