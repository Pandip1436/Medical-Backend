import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { ApprovalsModule } from '../approvals/approvals.module';
import { PaymentsModule } from '../payments/payments.module';
import { DispatchNotificationModule } from '../dispatch/dispatch-notification.module';
import { EventsModule } from '../events/events.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [ApprovalsModule, PaymentsModule, DispatchNotificationModule, EventsModule, SettingsModule],
  providers: [BillingService],
  controllers: [BillingController],
})
export class BillingModule {}
