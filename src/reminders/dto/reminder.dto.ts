import { IsString, IsInt, IsOptional, IsArray, IsBoolean, Min, Max, IsEnum, IsDateString, ValidateIf } from 'class-validator'

export class CreateReminderDto {
  @IsString() customerId: string
  @IsInt() @Min(1) @Max(31) dayOfMonth: number
  @IsString() title: string
  @IsOptional() @IsString() notes?: string
  @IsOptional() @IsString() branchId?: string
  // Products (medicines) this reminder is for. Named in the auto-WhatsApp
  // message and used to skip the cycle if the customer already bought one.
  @IsOptional() @IsArray() @IsString({ each: true }) productIds?: string[]
}

export class UpdateReminderDto {
  @IsOptional() @IsInt() @Min(1) @Max(31) dayOfMonth?: number
  @IsOptional() @IsString() title?: string
  @IsOptional() @IsString() notes?: string
  // Active one-off follow-up. Pass null to clear it (back to the monthly cycle).
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() followUpDate?: string | null
  // When provided, replaces the full set of linked products.
  @IsOptional() @IsArray() @IsString({ each: true }) productIds?: string[]
  // Soft-stop toggle: false = customer no longer wants reminders/WhatsApp.
  @IsOptional() @IsBoolean() isActive?: boolean
}

export class CreateContactLogDto {
  @IsEnum(['TALKED', 'NOT_RESPONDED', 'DENIED', 'NEED_TO_TALK', 'SCHEDULED', 'STOPPED']) status: string
  @IsOptional() @IsString() notes?: string
  // Customer asked to be contacted on this date ("call me in N days").
  @IsOptional() @IsDateString() followUpDate?: string
}
