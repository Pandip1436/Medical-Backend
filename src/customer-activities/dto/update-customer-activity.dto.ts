import { PartialType } from '@nestjs/swagger';
import { CreateCustomerActivityDto } from './create-customer-activity.dto';

// Most-used patch flow: flipping reminder status PENDING → DONE.
export class UpdateCustomerActivityDto extends PartialType(
  CreateCustomerActivityDto,
) {}
