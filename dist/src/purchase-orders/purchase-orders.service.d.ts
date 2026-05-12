import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
export declare class PurchaseOrdersService {
    private readonly prisma;
    private readonly numbering;
    constructor(prisma: PrismaService, numbering: DocumentNumberingService);
    create(createPurchaseOrderDto: CreatePurchaseOrderDto, userId: string, branchId?: string): Promise<{
        items: {
            id: string;
            productId: string;
            productName: string;
            requiredQty: number;
            lastPurchaseRate: Prisma.Decimal;
            expectedRate: Prisma.Decimal;
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
        totalAmount: Prisma.Decimal;
        status: import(".prisma/client").$Enums.POStatus;
        poNumber: string;
        expectedDelivery: Date | null;
        createdBy: string;
    }>;
    findAll(query?: string, branchId?: string, page?: number, pageSize?: number): Promise<({
        items: {
            id: string;
            productId: string;
            productName: string;
            requiredQty: number;
            lastPurchaseRate: Prisma.Decimal;
            expectedRate: Prisma.Decimal;
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
        totalAmount: Prisma.Decimal;
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
                lastPurchaseRate: Prisma.Decimal;
                expectedRate: Prisma.Decimal;
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
            totalAmount: Prisma.Decimal;
            status: import(".prisma/client").$Enums.POStatus;
            poNumber: string;
            expectedDelivery: Date | null;
            createdBy: string;
        })[];
        total: number;
        page: number;
        pageSize: number;
    }>;
    findOne(id: string, branchId?: string): Promise<{
        items: {
            id: string;
            productId: string;
            productName: string;
            requiredQty: number;
            lastPurchaseRate: Prisma.Decimal;
            expectedRate: Prisma.Decimal;
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
        totalAmount: Prisma.Decimal;
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
            lastPurchaseRate: Prisma.Decimal;
            expectedRate: Prisma.Decimal;
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
        totalAmount: Prisma.Decimal;
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
        totalAmount: Prisma.Decimal;
        status: import(".prisma/client").$Enums.POStatus;
        poNumber: string;
        expectedDelivery: Date | null;
        createdBy: string;
    }>;
}
