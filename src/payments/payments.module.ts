import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { ReconciliationService } from './reconciliation.service';
import { RazorpayProvider } from './providers/razorpay.provider';

// PrismaModule and CommonServicesModule (DocumentNumberingService) are
// @Global — no need to import them here.
@Module({
  providers: [PaymentsService, ReconciliationService, RazorpayProvider],
  exports: [PaymentsService, ReconciliationService, RazorpayProvider],
})
export class PaymentsModule {}
