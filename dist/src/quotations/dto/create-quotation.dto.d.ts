export declare class CreateQuotationItemDto {
    productId?: string;
    productName: string;
    batchId?: string;
    batchNumber?: string;
    quantity: number;
    mrp: number;
    rate: number;
    discountPercent: number;
    gstPercent: number;
    amount: number;
}
export declare class CreateQuotationDto {
    customerId?: string;
    customerName: string;
    items: CreateQuotationItemDto[];
    subtotal: number;
    cgst: number;
    sgst: number;
    total: number;
    validUntil?: string;
    notes?: string;
}
