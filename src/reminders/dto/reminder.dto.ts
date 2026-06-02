import { IsString, IsInt, IsOptional, Min, Max, IsEnum, IsDateString, ValidateIf } from 'class-validator'

export class CreateReminderDto {
  @IsString() customerId: string
  @IsInt() @Min(1) @Max(31) dayOfMonth: number
  @IsString() title: string
  @IsOptional() @IsString() notes?: string
  @IsOptional() @IsString() branchId?: string
}

export class UpdateReminderDto {
  @IsOptional() @IsInt() @Min(1) @Max(31) dayOfMonth?: number
  @IsOptional() @IsString() title?: string
  @IsOptional() @IsString() notes?: string
  // Active one-off follow-up. Pass null to clear it (back to the monthly cycle).
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() followUpDate?: string | null
}

export class CreateContactLogDto {
  @IsEnum(['TALKED', 'NOT_RESPONDED', 'DENIED', 'NEED_TO_TALK', 'SCHEDULED']) status: string
  @IsOptional() @IsString() notes?: string
  // Customer asked to be contacted on this date ("call me in N days").
  @IsOptional() @IsDateString() followUpDate?: string
}
