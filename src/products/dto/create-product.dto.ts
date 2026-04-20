import { IsString, IsNotEmpty, IsEnum, IsNumber, IsBoolean, IsOptional, Min } from 'class-validator';
import { ProductCategory, Schedule, StorageCondition } from '@prisma/client';

export class CreateProductDto {
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

  @IsEnum(ProductCategory)
  category: ProductCategory;

  @IsString()
  @IsOptional()
  subCategory?: string;

  @IsString()
  @IsNotEmpty()
  packSize: string;

  @IsString()
  @IsNotEmpty()
  unitOfMeasure: string;

  @IsEnum(Schedule)
  schedule: Schedule;

  @IsString()
  @IsNotEmpty()
  hsnCode: string;

  @IsBoolean()
  @IsOptional()
  isNarcotic?: boolean;

  @IsEnum(StorageCondition)
  storageCondition: StorageCondition;

  @IsNumber()
  @Min(0)
  mrp: number;

  @IsNumber()
  @Min(0)
  purchaseRate: number;

  @IsNumber()
  @Min(0)
  sellingRate: number;

  @IsNumber()
  @Min(0)
  wholesaleRate: number;

  @IsNumber()
  @Min(0)
  gstRate: number;

  @IsNumber()
  @Min(0)
  minStock: number;

  @IsNumber()
  @Min(0)
  maxStock: number;

  @IsNumber()
  @Min(0)
  reorderQty: number;

  @IsString()
  @IsNotEmpty()
  rackLocation: string;

  @IsString()
  @IsOptional()
  barcode?: string;
}
