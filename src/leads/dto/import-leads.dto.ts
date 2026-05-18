import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LeadSource, LeadStage } from '@prisma/client';

/**
 * One row from the import file — pre-mapped on the frontend so the backend
 * doesn't need to know about CSV columns. Title is required (it's the lead's
 * display name); everything else is optional.
 */
export class ImportLeadRowDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  // ── Contact fields ──
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  phoneCountryCode?: string;

  @IsOptional()
  @IsString()
  jobTitle?: string;

  @IsOptional()
  @IsString()
  company?: string;

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
  postalCode?: string;

  @IsOptional()
  @IsString()
  country?: string;

  // ── Lead-level fields ──
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @IsEnum(LeadStage)
  stage?: LeadStage;

  @IsOptional()
  value?: number | string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  score?: number;
}

export type DuplicateHandling = 'UPDATE' | 'SKIP' | 'CREATE';

export class ImportLeadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportLeadRowDto)
  leads: ImportLeadRowDto[];

  // What to do when a row's email/phone matches an existing contact.
  @IsIn(['UPDATE', 'SKIP', 'CREATE'])
  duplicateHandling: DuplicateHandling;

  @IsOptional()
  @IsEnum(LeadStage)
  defaultStage?: LeadStage;

  @IsOptional()
  @IsEnum(LeadSource)
  defaultSource?: LeadSource;
}

export interface ImportLeadsResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}
