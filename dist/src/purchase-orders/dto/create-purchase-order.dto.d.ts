import { POStatus } from '@prisma/client';
import { CreatePurchaseOrderItemDto } from './create-purchase-order-item.dto';
export declare class CreatePurchaseOrderDto {
    supplierId: string;
    supplierName: string;
    items: CreatePurchaseOrderItemDto[];
    totalAmount: number;
    status: POStatus;
    expectedDelivery?: string;
    branchId?: string;
}
