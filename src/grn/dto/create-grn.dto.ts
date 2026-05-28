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

  // Amount paid to the supplier at receive time. 0 (or omitted) = full credit.
  // Must not exceed supplierInvoiceAmount. Drives the GRN's paymentStatus and
  // books an initial SupplierPayment credit.
  @IsNumber()
  @Min(0)
  @IsOptional()
  amountPaid?: number;

  // Payment mode for the receive-time payment (CASH | CHEQUE | NEFT_UPI | UPI | CARD).
  @IsString()
  @IsOptional()
  paymentMode?: string;

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsBoolean()
  @IsOptional()
  isReplacement?: boolean;
}
