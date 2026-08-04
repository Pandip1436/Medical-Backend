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

  // Removed from the Add-Supplier form; optional now and defaulted to NET_30 in
  // the service so the required column + GRN due-date logic keep working.
  @IsEnum(PaymentTerms)
  @IsOptional()
  paymentTerms?: PaymentTerms;

  // Legacy single free-text bank field (kept for back-compat / import).
  @IsString()
  @IsOptional()
  bankDetails?: string;

  // Structured bank details (all optional).
  @IsString()
  @IsOptional()
  bankAccountName?: string;

  @IsString()
  @IsOptional()
  bankName?: string;

  @IsString()
  @IsOptional()
  bankAccountNumber?: string;

  @IsString()
  @IsOptional()
  bankIfsc?: string;

  @IsString()
  @IsOptional()
  bankUpiId?: string;

  // Parity with the customer form.
  @IsString()
  @IsOptional()
  alternatePhone?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // Supplier-level consent for low-stock WhatsApp alerts. Defaults to true
  // server-side via the schema so existing suppliers participate as soon as
  // the feature flag flips on; admin can opt individual suppliers out from
  // the SupplierFormDialog.
  @IsBoolean()
  @IsOptional()
  whatsappOptIn?: boolean;

  // Alternate WhatsApp number if it lives on a different line than `phone`.
  // When null/blank, the listener falls back to `phone`.
  @IsString()
  @IsOptional()
  whatsappNumber?: string;

  @IsString()
  @IsOptional()
  branchId?: string;
}
