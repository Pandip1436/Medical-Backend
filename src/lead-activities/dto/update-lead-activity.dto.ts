import { PartialType } from '@nestjs/swagger';
import { CreateLeadActivityDto } from './create-lead-activity.dto';

// Most-used patch flow: flipping REMINDER status PENDING → DONE.
export class UpdateLeadActivityDto extends PartialType(
  CreateLeadActivityDto,
) {}
