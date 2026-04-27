import { IsEnum, IsString, IsOptional, IsBoolean } from 'class-validator';

export enum NotificationType {
  LOW_STOCK = 'LOW_STOCK',
  EXPIRY = 'EXPIRY',
  PAYMENT_DUE = 'PAYMENT_DUE',
  SYSTEM = 'SYSTEM',
  APPROVAL = 'APPROVAL',
}

export class CreateNotificationDto {
  @IsEnum(NotificationType)
  type: NotificationType;

  @IsString()
  title: string;

  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  actionUrl?: string;

  @IsOptional()
  @IsString()
  branchId?: string;
}
