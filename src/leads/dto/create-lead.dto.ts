import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  LeadPipeline,
  LeadSource,
  LeadStage,
} from '@prisma/client';
import { CreateContactDto } from '../../contacts/dto/create-contact.dto';

export class CreateLeadDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsEnum(LeadPipeline)
  pipeline?: LeadPipeline;

  @IsOptional()
  @IsEnum(LeadStage)
  stage?: LeadStage;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsISO8601()
  expectedCloseDate?: string;

  @IsOptional()
  @IsISO8601()
  validUntil?: string;

  // ── Contact: exactly one of contactId OR contact must be present ──
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateContactDto)
  contact?: CreateContactDto;

  @IsOptional()
  @IsString()
  companyId?: string;

  // Optional override; defaults to requesting user.
  @IsOptional()
  @IsString()
  assignedToUserId?: string;
}
