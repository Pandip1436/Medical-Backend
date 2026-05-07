import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  Min,
  IsOptional,
  ValidateNested,
  ArrayMinSize,
  IsDateString,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GRNStatus } from '@prisma/client';
import { CreateGrnItemDto } from './create-grn-item.dto';

export class CreateGrnDto {
  @IsString()
  @IsOptional()
  poId?: string;

  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @IsString()
  @IsNotEmpty()
  supplierName: string;

  @IsString()
  @IsNotEmpty()
  supplierInvoiceNo: string;

  @IsDateString()
  @IsNotEmpty()
  supplierInvoiceDate: string;

  @IsNumber()
  @Min(0)
  supplierInvoiceAmount: number;

  @ValidateNested({ each: true })
  @Type(() => CreateGrnItemDto)
  @ArrayMinSize(1)
  items: CreateGrnItemDto[];

  @IsNumber()
  @Min(0)
  totalAmount: number;

  @IsEnum(GRNStatus)
  status: GRNStatus;
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsBoolean()
  @IsOptional()
  isReplacement?: boolean;
}
