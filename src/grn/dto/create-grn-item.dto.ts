import { IsString, IsNotEmpty, IsNumber, Min, IsDateString } from 'class-validator';

export class CreateGrnItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  productName: string;

  @IsNumber()
  @Min(1)
  orderedQty: number;

  @IsNumber()
  @Min(1)
  receivedQty: number;

  @IsNumber()
  @Min(0)
  freeQty: number;

  @IsString()
  @IsNotEmpty()
  batchNumber: string;

  @IsDateString()
  @IsNotEmpty()
  mfgDate: string;

  @IsDateString()
  @IsNotEmpty()
  expiryDate: string;

  @IsNumber()
  @Min(0)
  purchaseRate: number;

  @IsNumber()
  @Min(0)
  mrp: number;

  @IsNumber()
  @Min(0)
  damageQty: number;
}
