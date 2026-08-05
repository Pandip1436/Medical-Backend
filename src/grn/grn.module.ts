import { Module, forwardRef } from '@nestjs/common';
import { GrnService } from './grn.service';
import { GrnController } from './grn.controller';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  // forwardRef: ApprovalsModule imports GrnModule too — a near-expiry Purchase
  // Entry files a PURCHASE_ENTRY approval (GrnService → ApprovalsService), and
  // the approval executor creates the GRN (ApprovalsService → GrnService).
  imports: [forwardRef(() => ApprovalsModule)],
  providers: [GrnService],
  controllers: [GrnController],
  exports: [GrnService],
})
export class GrnModule {}
