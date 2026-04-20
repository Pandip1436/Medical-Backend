import { InvoiceType, BillingType, PaymentMode, InvoiceStatus } from '@prisma/client';
import { CreateInvoiceItemDto } from './create-invoice-item.dto';
export declare class CreateInvoiceDto {
    type: InvoiceType;
    billingType: BillingType;
    branchId?: string;
    customerId?: string;
    customerName: string;
    doctorName?: string;
    items: CreateInvoiceItemDto[];
    subtotal: number;
    productDiscount: number;
    taxableAmount: number;
    cgst: number;
    sgst: number;
    igst?: number;
    roundOff: number;
    grandTotal: number;
    paymentMode: PaymentMode;
    paymentDetails?: any;
    status: InvoiceStatus;
    amountPaid: number;
    changeReturned: number;
}
