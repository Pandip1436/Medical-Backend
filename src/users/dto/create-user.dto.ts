import { IsString, IsNotEmpty, IsEmail, IsEnum, MinLength, IsOptional, IsBoolean, IsNumber, Min, Max, IsArray, ArrayNotEmpty } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;

  // Full role set. `role` (singular) is derived from this by precedence in the
  // service. Kept optional/legacy for back-compat; prefer `roles`.
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  @IsOptional()
  roles?: Role[];

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  // Allowed branch set. Ignored for SUPER_ADMIN (all branches).
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  branchIds?: string[];

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  commissionRate?: number;
}
