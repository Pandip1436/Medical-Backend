import { Module, forwardRef } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditNotesModule } from '../credit-notes/credit-notes.module';

@Module({
  // forwardRef: CreditNotesModule imports ApprovalsModule too (CN create files
  // a SALES_RETURN approval; the approval executor creates the CN).
  imports: [PrismaModule, forwardRef(() => CreditNotesModule)],
  providers: [ApprovalsService],
  controllers: [ApprovalsController],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
