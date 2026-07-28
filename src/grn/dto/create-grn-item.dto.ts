import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsInt,
  Min,
  IsDateString,
  IsOptional,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
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

// M3: MRP may not be below the purchase cost at receipt — that's the same
// invariant the product master enforces (assertPricingSane), which the GRN path
// would otherwise bypass. Skipped when purchaseRate is 0 (unset).
@ValidatorConstraint({ name: 'mrpNotBelowPurchase', async: false })
class MrpNotBelowPurchase implements ValidatorConstraintInterface {
  validate(mrp: number, args: ValidationArguments) {
    const purchaseRate = Number((args.object as CreateGrnItemDto).purchaseRate);
    if (!Number.isFinite(purchaseRate) || purchaseRate <= 0) return true;
    return Number(mrp) >= purchaseRate;
  }
  defaultMessage() {
    return 'mrp cannot be below purchaseRate';
  }
}

// L2: a batch's manufacture date must be on or before its expiry date. Only
// checked when mfgDate is present (it's optional).
@ValidatorConstraint({ name: 'mfgBeforeExpiry', async: false })
class MfgBeforeExpiry implements ValidatorConstraintInterface {
  validate(mfgDate: string, args: ValidationArguments) {
    if (!mfgDate) return true;
    const mfg = new Date(mfgDate);
    const expiry = new Date((args.object as CreateGrnItemDto).expiryDate);
    if (Number.isNaN(mfg.getTime()) || Number.isNaN(expiry.getTime())) return true;
    return mfg <= expiry;
  }
  defaultMessage() {
    return 'mfgDate must be on or before expiryDate';
  }
}

export class CreateGrnItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  productName: string;

  // Quantities are whole units — Batch.quantity / Product.totalStock are Int,
  // so a fractional value would truncate or fail the DB write and desync stock.
  @IsInt()
  @Min(1)
  orderedQty: number;

  @IsInt()
  @Min(1)
  receivedQty: number;

  @IsInt()
  @Min(0)
  freeQty: number;

  @IsString()
  @IsNotEmpty()
  batchNumber: string;

  // Optional: the GRN form no longer captures mfgDate. When absent, the
  // service falls back to "today" because the DB column is non-nullable.
  @IsOptional()
  @IsDateString()
  @Validate(MfgBeforeExpiry)
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
  @Validate(MrpNotBelowPurchase)
  mrp: number;

  // Per-batch selling / wholesale rate captured at receipt so each batch is
  // sold against its own cost & MRP. Optional: when omitted (or 0) the service
  // defaults the batch to the product master's selling/wholesale rate.
  @IsOptional()
  @IsNumber()
  @Min(0)
  sellingRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  wholesaleRate?: number;

  // GST rate (%) for this line. The purchase rate is GST-inclusive; this is
  // stored so the detail view / PDF can extract the tax. Optional for back-compat.
  @IsOptional()
  @IsNumber()
  @Min(0)
  gstPercent?: number;
}
