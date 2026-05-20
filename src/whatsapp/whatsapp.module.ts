import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppRetryService } from './whatsapp-retry.service';

@Module({
  providers: [WhatsAppService, WhatsAppRetryService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
