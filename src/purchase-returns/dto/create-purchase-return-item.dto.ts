import {
  IsString,
  IsNotEmpty,
  IsNumber,
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

  @IsNumber()
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
