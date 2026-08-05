import { Module, forwardRef } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditNotesModule } from '../credit-notes/credit-notes.module';
import { PartyLinkModule } from '../party-link/party-link.module';
import { GrnModule } from '../grn/grn.module';

@Module({
  // forwardRef: CreditNotesModule + GrnModule both import ApprovalsModule too
  // (CN create files a SALES_RETURN approval, a near-expiry Purchase Entry files
  // a PURCHASE_ENTRY approval); the approval executor creates the CN / GRN.
  imports: [
    PrismaModule,
    forwardRef(() => CreditNotesModule),
    forwardRef(() => GrnModule),
    PartyLinkModule,
  ],
  providers: [ApprovalsService],
  controllers: [ApprovalsController],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
