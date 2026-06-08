import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { DeliveryStatus } from '@prisma/client';

// A single timeline entry added to a delivery (e.g. "Out for Delivery —
// Chennai Hub"). Appending an event also advances the delivery's top-level
// status to this event's status.
export class AddDeliveryEventDto {
  @IsEnum(DeliveryStatus)
  status: DeliveryStatus;

  @IsString()
  @IsOptional()
  location?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsDateString()
  @IsOptional()
  occurredAt?: string;
}
