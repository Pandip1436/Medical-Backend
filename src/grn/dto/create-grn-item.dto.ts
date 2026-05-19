import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsDateString,
  IsOptional,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

// Reject expiry dates that are in the past. mfgDate is no longer required
// or captured at the form level, so we only check the future-dated guard here.
@ValidatorConstraint({ name: 'expiryNotInPast', async: false })
class ExpiryNotInPast implements ValidatorConstraintInterface {
  validate(value: string) {
    const expiry = new Date(value);
    if (Number.isNaN(expiry.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return expiry >= today;
  }
  defaultMessage() {
    return 'expiryDate must be on or after today';
  }
}

export class CreateGrnItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  productName: string;

  @IsNumber()
  @Min(1)
  orderedQty: number;

  @IsNumber()
  @Min(1)
  receivedQty: number;

  @IsNumber()
  @Min(0)
  freeQty: number;

  @IsString()
  @IsNotEmpty()
  batchNumber: string;

  // Optional: the GRN form no longer captures mfgDate. When absent, the
  // service falls back to "today" because the DB column is non-nullable.
  @IsOptional()
  @IsDateString()
  mfgDate?: string;

  @IsDateString()
  @IsNotEmpty()
  @Validate(ExpiryNotInPast)
  expiryDate: string;

  @IsNumber()
  @Min(0)
  purchaseRate: number;

  @IsNumber()
  @Min(0)
  mrp: number;
}
