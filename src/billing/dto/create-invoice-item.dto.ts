import { IsString, IsNotEmpty, IsNumber, Min, IsDateString } from 'class-validator';

export class CreateInvoiceItemDto {
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
  @IsNotEmpty()
  expiryDate: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  mrp: number;

  @IsNumber()
  @Min(0)
  rate: number;

  @IsNumber()
  @Min(0)
  discountPercent: number;

  @IsNumber()
  @Min(0)
  gstPercent: number;

  @IsNumber()
  @Min(0)
  amount: number;
}
