import { IsString, IsNotEmpty, IsNumber, Min, IsDateString, IsOptional } from 'class-validator';

export class CreateExpenseDto {
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  @IsNotEmpty()
  paymentMode: string;

  @IsString()
  @IsOptional()
  receiptImage?: string;

  @IsString()
  @IsOptional()
  branchId?: string;
}
