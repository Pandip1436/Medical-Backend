import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, Min, IsBoolean } from 'class-validator';
import { CustomerType } from '@prisma/client';

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
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

  @IsString()
  @IsOptional()
  referredBy?: string;

  // Customer-level consent for transactional WhatsApp messages (invoice +
  // payment QR delivery via Meta Cloud API). Default true so existing rows
  // and new customers are auto-opted-in unless the user explicitly toggles
  // it off. Meta also auto-flips this to false if the customer's number
  // returns the "user opt-out" error code (131048 / 131049).
  @IsBoolean()
  @IsOptional()
  whatsappOptIn?: boolean;
}
