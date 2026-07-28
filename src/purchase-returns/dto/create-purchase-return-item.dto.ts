import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsInt,
  Min,
  IsDateString,
} from 'class-validator';

export class CreatePurchaseReturnItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  productName: string;

  @IsString()
  @IsNotEmpty()
  batchId: string;

  @IsString()
  @IsNotEmpty()
  batchNumber: string;

  @IsDateString()
  expiryDate: string;

  // Stock is tracked in whole units (Batch.quantity / totalStock are Int), so
  // a fractional return qty would truncate/desync the columns. Reject it.
  @IsInt()
  @Min(1)
  returnedQty: number;

  @IsNumber()
  @Min(0)
  purchaseRate: number;

  @IsNumber()
  @Min(0)
  gstPercent: number;

  @IsNumber()
  @Min(0)
  amount: number;
}
