import { Module, forwardRef } from '@nestjs/common';
import { CreditNotesService } from './credit-notes.service';
import { CreditNotesController } from './credit-notes.controller';
import { ApprovalsModule } from '../approvals/approvals.module';
import { SettingsModule } from '../settings/settings.module';

// Gate 1: a non-super-admin's CN is filed as a SALES_RETURN ApprovalRequest;
// once a Super Admin approves, the approvals executor calls back into
// CreditNotesService.createPendingReview — hence the mutual forwardRef.
@Module({
  imports: [forwardRef(() => ApprovalsModule), SettingsModule],
  providers: [CreditNotesService],
  controllers: [CreditNotesController],
  exports: [CreditNotesService],
})
export class CreditNotesModule {}
