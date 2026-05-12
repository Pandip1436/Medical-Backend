export declare class AdjustStockDto {
    adjustedQty: number;
    reason: string;
    notes?: string;
}
export declare class BulkAdjustStockItemDto {
    productId: string;
    batchId: string;
    adjustedQty: number;
    reason: string;
}
export declare class BulkAdjustStockDto {
    items: BulkAdjustStockItemDto[];
}
