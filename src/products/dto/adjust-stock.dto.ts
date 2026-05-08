import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AdjustStockDto {
  // Final qty to set on the batch (NOT the diff). Must be a non-negative integer.
  @IsInt({ message: 'adjustedQty must be an integer' })
  @Min(0, { message: 'adjustedQty cannot be negative' })
  adjustedQty: number;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class BulkAdjustStockItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  batchId: string;

  @IsInt({ message: 'adjustedQty must be an integer' })
  @Min(0, { message: 'adjustedQty cannot be negative' })
  adjustedQty: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class BulkAdjustStockDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkAdjustStockItemDto)
  items: BulkAdjustStockItemDto[];
}
