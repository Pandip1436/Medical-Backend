import { Module } from '@nestjs/common';
import { CreditNotesService } from './credit-notes.service';
import { CreditNotesController } from './credit-notes.controller';

// ApprovalsModule import retired: pharmacist-created CNs no longer file an
// ApprovalRequest; both roles now create a CreditNote directly with
// status=PENDING_REVIEW, and admin approves via the credit-notes detail page.
@Module({
  imports: [],
  providers: [CreditNotesService],
  controllers: [CreditNotesController],
})
export class CreditNotesModule {}
