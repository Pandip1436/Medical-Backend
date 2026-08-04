import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, Min, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { CustomerType } from '@prisma/client';

// Trim every string at the DTO boundary so a stray trailing space typed by
// the operator (or pasted in from a spreadsheet) doesn't survive into the
// Customer.name column — which then gets denormalised onto Invoice.customerName
// and breaks CSV exports + downstream joins. Bug #7.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  @Transform(trim)
  name!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsString()
  @IsOptional()
  alternatePhone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsEnum(CustomerType)
  @IsOptional()
  type?: CustomerType;

  @IsString()
  @IsOptional()
  doctorRef?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  creditLimit?: number;

  @IsString()
  @IsOptional()
  gstin?: string;

  @IsString()
  @IsOptional()
  dlNumber?: string;

  @IsString()
  @IsOptional()
  registrationNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  // Shared "party" fields — captured on the WHOLESALE customer form (a wholesale
  // customer is also a supplier) and synced to the linked supplier twin.
  @IsString()
  @IsOptional()
  contactPerson?: string;

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

  @IsString()
  @IsOptional()
  referredBy?: string;

  // How the customer was acquired (Walk-in, Referral, IndiaMART, …). Optional.
  @IsString()
  @IsOptional()
  source?: string;

  // Customer-level consent for transactional WhatsApp messages (invoice +
  // payment QR delivery via Meta Cloud API). Default true so existing rows
  // and new customers are auto-opted-in unless the user explicitly toggles
  // it off. Meta also auto-flips this to false if the customer's number
  // returns the "user opt-out" error code (131048 / 131049).
  @IsBoolean()
  @IsOptional()
  whatsappOptIn?: boolean;
}
