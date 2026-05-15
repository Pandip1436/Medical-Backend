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
import { Type } from 'class-transformer';

// Reject expense entries dated in the future. Fat-fingers (e.g. 2099-01-01)
// would land in P&L and silently distort future periods. We allow a small
// timezone buffer (1 day) so a user posting at 23:59 IST doesn't get
// rejected by the UTC-stored date check.
@ValidatorConstraint({ name: 'expenseDateNotFuture', async: false })
class ExpenseDateNotFuture implements ValidatorConstraintInterface {
  validate(value: string) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return false;
    const limit = new Date();
    limit.setDate(limit.getDate() + 1);
    limit.setHours(23, 59, 59, 999);
    return d <= limit;
  }
  defaultMessage() {
    return 'expense date cannot be in the future';
  }
}

export class CreateExpenseDto {
  @IsDateString()
  @IsNotEmpty()
  @Validate(ExpenseDateNotFuture)
  date: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  // multipart/form-data submissions send amount as a string; coerce to number
  // so validation works against either JSON or FormData payloads.
  @Type(() => Number)
  @IsNumber()
  // Reject zero/negative amounts — phantom 0-rupee expenses pollute reports
  // and make reconciliation harder.
  @Min(0.01, { message: 'amount must be greater than zero' })
  amount: number;

  @IsString()
  @IsNotEmpty()
  paymentMode: string;

  @IsString()
  @IsOptional()
  receiptImage?: string;

  @IsString()
  @IsOptional()
  branchId?: string;
}
