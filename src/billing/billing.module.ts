import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { ApprovalsModule } from '../approvals/approvals.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [ApprovalsModule, PaymentsModule],
  providers: [BillingService],
  controllers: [BillingController],
})
export class BillingModule {}
