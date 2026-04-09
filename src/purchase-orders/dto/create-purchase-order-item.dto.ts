import { IsString, IsNotEmpty, IsNumber, Min, IsOptional } from 'class-validator';

export class CreatePurchaseOrderItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  productName: string;

  @IsNumber()
  @Min(1)
  requiredQty: number;

  @IsNumber()
  @Min(0)
  lastPurchaseRate: number;

  @IsNumber()
  @Min(0)
  expectedRate: number;

  @IsString()
  @IsOptional()
  remarks?: string;
}
