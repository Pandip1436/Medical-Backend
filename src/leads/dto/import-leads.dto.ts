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
import { Type, Transform } from 'class-transformer';
import { LeadSource, LeadStage } from '@prisma/client';

// ── Enum coercion for imported CSV cells ──────────────────────────────────
// Import files come from spreadsheets / other CRMs, so a Stage/Source cell can
// be any case ("Lead"/"lead"), a common synonym ("New", "Interested"), or blank.
// A bare @IsEnum rejects all of those (and @IsOptional does NOT skip an empty
// string), which is why every row failed. We normalize here BEFORE validation:
// recognized values map to the enum; blank/unknown collapse to `undefined` so
// the row falls back to the import's defaultStage/defaultSource (→ LEAD) instead
// of hard-failing.
const norm = (value: unknown): string =>
  value == null ? '' : String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');

const STAGE_ALIASES: Record<string, LeadStage> = {
  LEAD: LeadStage.LEAD, NEW: LeadStage.LEAD, OPEN: LeadStage.LEAD, CONTACTED: LeadStage.LEAD,
  QUALIFIED: LeadStage.QUALIFIED, INTERESTED: LeadStage.QUALIFIED,
  PROPOSAL: LeadStage.PROPOSAL, QUOTE: LeadStage.PROPOSAL, QUOTED: LeadStage.PROPOSAL,
  NEGOTIATION: LeadStage.NEGOTIATION, NEGOTIATING: LeadStage.NEGOTIATION,
  WON: LeadStage.WON, CLOSED_WON: LeadStage.WON, CLOSEDWON: LeadStage.WON,
  LOST: LeadStage.LOST, CLOSED_LOST: LeadStage.LOST, CLOSEDLOST: LeadStage.LOST,
};

function normalizeStage(value: unknown): LeadStage | undefined {
  const key = norm(value);
  return key ? STAGE_ALIASES[key] : undefined;
}

function normalizeSource(value: unknown): LeadSource | undefined {
  const key = norm(value);
  if (!key) return undefined;
  return (Object.values(LeadSource) as string[]).includes(key)
    ? (key as LeadSource)
    : undefined;
}

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
  // Normalize first (case/synonym/blank tolerant); unknown → undefined so the
  // row inherits the import's defaultSource/defaultStage rather than erroring.
  @IsOptional()
  @Transform(({ value }) => normalizeSource(value))
  @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional()
  @Transform(({ value }) => normalizeStage(value))
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
