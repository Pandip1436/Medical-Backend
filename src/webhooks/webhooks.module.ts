import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { RazorpayWebhookController } from './razorpay.controller';
import { WhatsAppWebhookController } from './whatsapp.controller';

@Module({
  imports: [PaymentsModule, WhatsAppModule],
  controllers: [RazorpayWebhookController, WhatsAppWebhookController],
})
export class WebhooksModule {}
