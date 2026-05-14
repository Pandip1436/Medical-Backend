import {
  IsEnum,
  IsOptional,
  IsString,
  IsISO8601,
  ValidateIf,
} from 'class-validator';
import { SupplierActivityType, SupplierActivityStatus } from '@prisma/client';

export class CreateSupplierActivityDto {
  @IsEnum(SupplierActivityType)
  type: SupplierActivityType;

  // Required for CALL / WHATSAPP / EMAIL / NOTE. Optional on REMINDER.
  @ValidateIf((o) => o.type !== SupplierActivityType.REMINDER)
  @IsString()
  notes?: string;

  // Required for REMINDER, ignored otherwise.
  @ValidateIf((o) => o.type === SupplierActivityType.REMINDER)
  @IsString()
  title?: string;

  // Required for REMINDER (ISO date string), ignored otherwise.
  @ValidateIf((o) => o.type === SupplierActivityType.REMINDER)
  @IsISO8601()
  dueAt?: string;

  // Optional ISO timestamp of when the interaction happened. Defaults to now.
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @IsOptional()
  @IsEnum(SupplierActivityStatus)
  status?: SupplierActivityStatus;

  @IsOptional()
  @IsString()
  contactName?: string;

  // EMAIL only.
  @IsOptional()
  @IsString()
  subject?: string;
}
