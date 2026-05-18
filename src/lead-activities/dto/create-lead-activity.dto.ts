import {
  IsEnum,
  IsOptional,
  IsString,
  IsISO8601,
  ValidateIf,
} from 'class-validator';
import { LeadActivityType, LeadActivityStatus } from '@prisma/client';

export class CreateLeadActivityDto {
  @IsEnum(LeadActivityType)
  type: LeadActivityType;

  // Required for CALL / WHATSAPP / EMAIL / NOTE. Optional on REMINDER.
  @ValidateIf((o) => o.type !== LeadActivityType.REMINDER)
  @IsString()
  notes?: string;

  // Required for REMINDER, ignored otherwise.
  @ValidateIf((o) => o.type === LeadActivityType.REMINDER)
  @IsString()
  title?: string;

  // Required for REMINDER (ISO date string), ignored otherwise.
  @ValidateIf((o) => o.type === LeadActivityType.REMINDER)
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @IsOptional()
  @IsEnum(LeadActivityStatus)
  status?: LeadActivityStatus;

  @IsOptional()
  @IsString()
  contactName?: string;

  // EMAIL only.
  @IsOptional()
  @IsString()
  subject?: string;
}
