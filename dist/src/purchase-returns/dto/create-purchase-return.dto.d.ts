import { PurchaseReturnStatus } from '@prisma/client';
import { CreatePurchaseReturnItemDto } from './create-purchase-return-item.dto';
export declare class CreatePurchaseReturnDto {
    supplierId: string;
    supplierName: string;
    grnId?: string;
    reason: string;
    items: CreatePurchaseReturnItemDto[];
    subtotal: number;
    cgst?: number;
    sgst?: number;
    igst?: number;
    totalAmount: number;
    status?: PurchaseReturnStatus;
    notes?: string;
}
