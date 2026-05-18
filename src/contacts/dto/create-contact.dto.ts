import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';
import { ContactStatus, LeadSource } from '@prisma/client';

export class CreateContactDto {
  @IsString()
  @MinLength(1)
  firstName: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  // Default '+91' applied at the service layer if omitted.
  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{1,4}$/)
  phoneCountryCode?: string;

  // Local part of the phone — service layer enforces (branchId, phone) uniqueness.
  @IsString()
  @Length(7, 15)
  @Matches(/^\d+$/)
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  // ISO 3166-1 alpha-2 (e.g. 'IN'). Useful when ingesting IndiaMART payloads.
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryIso?: string;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsEnum(ContactStatus)
  status?: ContactStatus;

  // Optional override; defaults to the requesting user.
  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
