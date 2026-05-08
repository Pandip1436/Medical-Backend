import {
  IsString,
  IsNotEmpty,
  IsNumber,
  Min,
  IsDateString,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';

// Reject expiry dates that are in the past or before mfgDate. Pharmacies
// shouldn't be receiving stock that's already expired, and the BE was
// previously trusting any IsDateString here.
@ValidatorConstraint({ name: 'expiryAfterMfgAndFuture', async: false })
class ExpiryAfterMfgAndFuture implements ValidatorConstraintInterface {
  validate(value: string, args: ValidationArguments) {
    const obj = args.object as { mfgDate?: string };
    const expiry = new Date(value);
    if (Number.isNaN(expiry.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (expiry < today) return false;
    if (obj.mfgDate) {
      const mfg = new Date(obj.mfgDate);
      if (!Number.isNaN(mfg.getTime()) && expiry < mfg) return false;
    }
    return true;
  }
  defaultMessage() {
    return 'expiryDate must be on or after today and not earlier than mfgDate';
  }
}

@ValidatorConstraint({ name: 'mfgNotInFuture', async: false })
class MfgNotInFuture implements ValidatorConstraintInterface {
  validate(value: string) {
    const mfg = new Date(value);
    if (Number.isNaN(mfg.getTime())) return false;
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return mfg <= today;
  }
  defaultMessage() {
    return 'mfgDate cannot be in the future';
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

  @IsDateString()
  @IsNotEmpty()
  @Validate(MfgNotInFuture)
  mfgDate: string;

  @IsDateString()
  @IsNotEmpty()
  @Validate(ExpiryAfterMfgAndFuture)
  expiryDate: string;

  @IsNumber()
  @Min(0)
  purchaseRate: number;

  @IsNumber()
  @Min(0)
  mrp: number;

  @IsNumber()
  @Min(0)
  damageQty: number;
}
