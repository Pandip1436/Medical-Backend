import { Schedule, StorageCondition } from '@prisma/client';
export declare class CreateProductDto {
    name: string;
    genericName: string;
    saltComposition?: string;
    manufacturer: string;
    categoryId?: string;
    subCategory?: string;
    packSize: string;
    unitOfMeasure: string;
    schedule: Schedule;
    hsnCode: string;
    isNarcotic?: boolean;
    storageCondition: StorageCondition;
    mrp: number;
    purchaseRate: number;
    sellingRate: number;
    wholesaleRate: number;
    gstRate: number;
    minStock: number;
    maxStock: number;
    reorderQty: number;
    rackLocation: string;
}
