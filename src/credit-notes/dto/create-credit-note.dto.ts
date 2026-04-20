import { IsString, IsNotEmpty, IsNumber, Min, IsOptional, ValidateNested, ArrayMinSize, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { SettlementMode } from '@prisma/client';
import { CreateCreditNoteItemDto } from './create-credit-note-item.dto';

export class CreateCreditNoteDto {
  @IsString()
  @IsNotEmpty()
  invoiceId: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @ValidateNested({ each: true })
  @Type(() => CreateCreditNoteItemDto)
  @ArrayMinSize(1)
  items: CreateCreditNoteItemDto[];

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

  @IsEnum(SettlementMode)
  @IsOptional()
  settlementMode?: SettlementMode;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  branchId?: string;
}
