import { GRNStatus } from '@prisma/client';
import { CreateGrnItemDto } from './create-grn-item.dto';
export declare class CreateGrnDto {
    poId?: string;
    supplierId: string;
    supplierName: string;
    supplierInvoiceNo: string;
    supplierInvoiceDate: string;
    supplierInvoiceAmount: number;
    items: CreateGrnItemDto[];
    totalAmount: number;
    status: GRNStatus;
    branchId?: string;
    isReplacement?: boolean;
}
