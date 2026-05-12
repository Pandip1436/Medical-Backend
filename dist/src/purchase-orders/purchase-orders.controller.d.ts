import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
export declare class PurchaseOrdersController {
    private readonly poService;
    constructor(poService: PurchaseOrdersService);
    create(createPurchaseOrderDto: CreatePurchaseOrderDto, req: AuthenticatedRequest, branchId?: string): Promise<{
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
    findAll(req: AuthenticatedRequest, q?: string, branchId?: string, page?: string, pageSize?: string): Promise<({
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
    })[] | {
        items: ({
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
        })[];
        total: number;
        page: number;
        pageSize: number;
    }>;
    findOne(id: string, req: AuthenticatedRequest): Promise<{
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
    update(id: string, updatePurchaseOrderDto: UpdatePurchaseOrderDto, req: AuthenticatedRequest): Promise<{
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
    remove(id: string, req: AuthenticatedRequest): Promise<{
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
