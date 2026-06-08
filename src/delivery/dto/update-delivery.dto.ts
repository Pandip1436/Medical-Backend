import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
} from 'class-validator';
import { DeliveryStatus } from '@prisma/client';

// Partial update of courier details on a delivery record. Sent by the
// tracking page after manual entry or OCR auto-fill (courier name, tracking
// id, dispatch date) and on a manual status change.
export class UpdateDeliveryDto {
  @IsString()
  @IsOptional()
  courierName?: string;

  @IsString()
  @IsOptional()
  trackingId?: string;

  @IsDateString()
  @IsOptional()
  dispatchDate?: string;

  @IsEnum(DeliveryStatus)
  @IsOptional()
  status?: DeliveryStatus;

  @IsString()
  @IsOptional()
  mobileNumber?: string;

  @IsString()
  @IsOptional()
  deliveryAddress?: string;

  // Original filename of the uploaded courier receipt (for display).
  @IsString()
  @IsOptional()
  receiptName?: string;

  // Raw OCR text captured client-side (Tesseract.js) — stored for audit.
  @IsString()
  @IsOptional()
  ocrText?: string;
}
