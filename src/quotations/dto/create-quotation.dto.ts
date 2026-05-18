import { IsString, IsNotEmpty, IsNumber, Min, IsOptional, ValidateNested, ArrayMinSize, IsDateString, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateQuotationItemDto {
  @IsString()
  @IsOptional()
  productId?: string;

  @IsString()
  @IsNotEmpty()
  productName: string;

  @IsString()
  @IsOptional()
  batchId?: string;

  @IsString()
  @IsOptional()
  batchNumber?: string;

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

export class CreateQuotationDto {
  @IsString()
  @IsOptional()
  customerId?: string;

  @IsString()
  @IsNotEmpty()
  customerName: string;

  @IsString()
  @IsOptional()
  @Matches(/^\d{10}$/, { message: 'Phone must be exactly 10 digits' })
  customerPhone?: string;

  @ValidateNested({ each: true })
  @Type(() => CreateQuotationItemDto)
  @ArrayMinSize(1)
  items: CreateQuotationItemDto[];

  @IsNumber()
  @Min(0)
  subtotal: number;

  @IsNumber()
  @Min(0)
  cgst: number;

  @IsNumber()
  @Min(0)
  sgst: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  deliveryCharge?: number;

  @IsNumber()
  @Min(0)
  total: number;

  @IsDateString()
  @IsOptional()
  validUntil?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  // Optional link to a CRM Lead. When set, the resulting quotation shows up
  // in /leads/:id/quotations and the lead's Quotations tab. Set by the
  // "Create Quote" quick action on the lead detail panel.
  @IsString()
  @IsOptional()
  leadId?: string;
}
