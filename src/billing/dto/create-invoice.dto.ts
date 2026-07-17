import { IsString, IsNotEmpty, IsEnum, IsNumber, Min, IsOptional, IsBoolean, ValidateNested, ArrayMinSize, IsDateString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { InvoiceType, BillingType, PaymentMode, InvoiceStatus } from '@prisma/client';
import { CreateInvoiceItemDto } from './create-invoice-item.dto';

export class CreateInvoiceDto {
  @IsEnum(InvoiceType)
  type: InvoiceType;

  @IsEnum(BillingType)
  billingType: BillingType;

  // No-charge replacement invoice (fulfilling a REPLACEMENT credit note) —
  // gets its own REPL number series instead of the regular INV series.
  @IsOptional()
  @IsBoolean()
  isReplacement?: boolean;

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

  // Reference for the paid portion collected at billing (UPI txn id / card ref).
  // Stored on the resulting Payment row for reconciliation. Empty for cash.
  @IsOptional()
  @IsString()
  paymentReference?: string;

  // How money collected at billing actually came in (CASH/UPI/CARD). Set even
  // when `paymentMode` is CREDIT — a partial cash/UPI collection marks the
  // invoice as credit but the payment-history row must keep the real method.
  @IsOptional()
  @IsIn(['CASH', 'UPI', 'CARD'])
  collectionMethod?: 'CASH' | 'UPI' | 'CARD';

  // Payment due date for sales that leave a balance (ISO string). Sent for a
  // pure credit sale OR a partial cash/UPI/card collection; optional here so
  // fully-paid invoices omit it.
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
