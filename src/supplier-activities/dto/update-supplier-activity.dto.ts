import { PartialType } from '@nestjs/swagger';
import { CreateSupplierActivityDto } from './create-supplier-activity.dto';

// Most-used patch flow: flipping reminder status PENDING → DONE.
export class UpdateSupplierActivityDto extends PartialType(
  CreateSupplierActivityDto,
) {}
