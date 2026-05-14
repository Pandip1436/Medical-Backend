import {
  IsEnum,
  IsOptional,
  IsString,
  IsISO8601,
  ValidateIf,
} from 'class-validator';
import { CustomerActivityType, CustomerActivityStatus } from '@prisma/client';

export class CreateCustomerActivityDto {
  @IsEnum(CustomerActivityType)
  type: CustomerActivityType;

  // Required for CALL / WHATSAPP / EMAIL / NOTE. Optional on REMINDER.
  @ValidateIf((o) => o.type !== CustomerActivityType.REMINDER)
  @IsString()
  notes?: string;

  // Required for REMINDER, ignored otherwise.
  @ValidateIf((o) => o.type === CustomerActivityType.REMINDER)
  @IsString()
  title?: string;

  // Required for REMINDER (ISO date string), ignored otherwise.
  @ValidateIf((o) => o.type === CustomerActivityType.REMINDER)
  @IsISO8601()
  dueAt?: string;

  // Optional ISO timestamp of when the interaction happened. Defaults to now.
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @IsOptional()
  @IsEnum(CustomerActivityStatus)
  status?: CustomerActivityStatus;

  @IsOptional()
  @IsString()
  contactName?: string;

  // EMAIL only.
  @IsOptional()
  @IsString()
  subject?: string;
}
