import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsEmail,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { PaymentTerms } from '@prisma/client';

export class CreateSupplierDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  contactPerson: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  gstin: string;

  @IsString()
  @IsNotEmpty()
  drugLicense: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsEnum(PaymentTerms)
  paymentTerms: PaymentTerms;

  @IsString()
  @IsOptional()
  bankDetails?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  branchId?: string;
}
