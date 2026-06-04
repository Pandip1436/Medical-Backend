import { IsString, IsNotEmpty, IsEnum, IsNumber, Min, IsOptional, ValidateNested, ArrayMinSize, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { InvoiceType, BillingType, PaymentMode, InvoiceStatus } from '@prisma/client';
import { CreateInvoiceItemDto } from './create-invoice-item.dto';

export class CreateInvoiceDto {
  @IsEnum(InvoiceType)
  type: InvoiceType;

  @IsEnum(BillingType)
  billingType: BillingType;

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsString()
  @IsOptional()
  customerId?: string;

  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @IsOptional()
  doctorName?: string;

  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  @ArrayMinSize(1)
  items: CreateInvoiceItemDto[];

  @IsNumber()
  @Min(0)
  subtotal: number;

  @IsNumber()
  @Min(0)
  productDiscount: number;

  @IsNumber()
  @Min(0)
  taxableAmount: number;

  @IsNumber()
  @Min(0)
  cgst: number;

  @IsNumber()
  @Min(0)
  sgst: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  igst?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  deliveryCharge?: number;

  @IsNumber()
  roundOff: number;

  @IsNumber()
  @Min(0)
  grandTotal: number;

  @IsEnum(PaymentMode)
  paymentMode: PaymentMode;

  @IsOptional()
  paymentDetails?: any;

  // Payment due date for credit sales (ISO string). Required on the UI for
  // CREDIT mode; optional here so CASH/UPI/card invoices omit it.
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsEnum(InvoiceStatus)
  status: InvoiceStatus;

  @IsNumber()
  @Min(0)
  amountPaid: number;

  @IsNumber()
  @Min(0)
  changeReturned: number;

  @IsOptional()
  @IsString()
  salespersonId?: string;

  @IsOptional()
  @IsString()
  salespersonName?: string;

  // Optional link to a CRM Lead. When set, the resulting invoice shows up
  // in /leads/:id/invoices and the lead's Invoices tab.
  @IsOptional()
  @IsString()
  leadId?: string;
}
