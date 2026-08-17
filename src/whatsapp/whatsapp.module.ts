import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppRetryService } from './whatsapp-retry.service';
import { WhatsAppSettingsService } from './whatsapp-settings.service';
import { WhatsAppSettingsController } from './whatsapp-settings.controller';

@Module({
  controllers: [WhatsAppSettingsController],
  providers: [WhatsAppService, WhatsAppRetryService, WhatsAppSettingsService],
  // WhatsAppRetryService is exported so the cron tick can drive the sweep
  // directly — its @Cron timer does not fire on Cloud Run (see CronService).
  // WhatsAppSettingsService is exported for the listeners that gate on it.
  exports: [WhatsAppService, WhatsAppRetryService, WhatsAppSettingsService],
})
export class WhatsAppModule {}
