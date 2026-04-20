import { IsString, IsNotEmpty, IsEnum, IsNumber, Min, IsOptional, ValidateNested, ArrayMinSize, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { POStatus } from '@prisma/client';
import { CreatePurchaseOrderItemDto } from './create-purchase-order-item.dto';

export class CreatePurchaseOrderDto {
  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @IsString()
  @IsNotEmpty()
  supplierName: string;

  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  @ArrayMinSize(1)
  items: CreatePurchaseOrderItemDto[];

  @IsNumber()
  @Min(0)
  totalAmount: number;

  @IsEnum(POStatus)
  status: POStatus;

  @IsDateString()
  @IsOptional()
  expectedDelivery?: string;
  @IsString()
  @IsOptional()
  branchId?: string;
}