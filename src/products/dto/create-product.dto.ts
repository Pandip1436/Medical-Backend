import { IsString, IsNotEmpty, IsEnum, IsNumber, IsBoolean, IsOptional, Min } from 'class-validator';
import { Schedule, StorageCondition } from '@prisma/client';

export class CreateProductDto {
  // Operator's own item code (MARG ItemCode / supplier SKU). Optional: most
  // products don't have one, and it's unique per branch only when set.
  @IsString()
  @IsOptional()
  productCode?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  genericName: string;

  @IsString()
  @IsOptional()
  saltComposition?: string;

  @IsString()
  @IsNotEmpty()
  manufacturer: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  subCategory?: string;

  @IsString()
  @IsOptional()
  packSize?: string;

  @IsString()
  @IsOptional()
  unitOfMeasure?: string;

  @IsEnum(Schedule)
  schedule: Schedule;

  @IsString()
  @IsNotEmpty()
  hsnCode: string;

  @IsBoolean()
  @IsOptional()
  isNarcotic?: boolean;

  // Storage condition is no longer collected in the UI — defaults to ROOM_TEMP
  // in the Prisma schema when omitted.
  @IsEnum(StorageCondition)
  @IsOptional()
  storageCondition?: StorageCondition;

  @IsNumber()
  @Min(0)
  mrp: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  purchaseRate?: number;

  @IsNumber()
  @Min(0)
  sellingRate: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  wholesaleRate?: number;

  @IsNumber()
  @Min(0)
  gstRate: number;

  // Required — feeds the low-stock alert pipeline in BillingService.
  @IsNumber()
  @Min(0)
  minStock: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  maxStock?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  reorderQty?: number;

  @IsString()
  @IsOptional()
  rackLocation?: string;
}
