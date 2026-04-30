import { IsString, IsNotEmpty, IsNumber, Min, IsOptional, ValidateNested, ArrayMinSize, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseReturnStatus, PurchaseReturnSettlement } from '@prisma/client';
import { CreatePurchaseReturnItemDto } from './create-purchase-return-item.dto';

export class CreatePurchaseReturnDto {
  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @IsString()
  @IsNotEmpty()
  supplierName: string;

  @IsString()
  @IsOptional()
  grnId?: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseReturnItemDto)
  @ArrayMinSize(1)
  items: CreatePurchaseReturnItemDto[];

  @IsNumber()
  @Min(0)
  subtotal: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  cgst?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sgst?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  igst?: number;

  @IsNumber()
  @Min(0)
  totalAmount: number;

  @IsEnum(PurchaseReturnStatus)
  @IsOptional()
  status?: PurchaseReturnStatus;

  @IsEnum(PurchaseReturnSettlement)
  @IsOptional()
  settlementMode?: PurchaseReturnSettlement;

  @IsString()
  @IsOptional()
  notes?: string;
}
