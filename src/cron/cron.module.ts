import { Module } from '@nestjs/common';
import { CronController } from './cron.controller';
import { CronService } from './cron.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SharedFilesModule } from '../shared-files/shared-files.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

// Externally-triggered scheduler. See CronService for why the in-process
// timers cannot be trusted on Cloud Run.
@Module({
  imports: [PrismaModule, NotificationsModule, SharedFilesModule, WhatsAppModule],
  controllers: [CronController],
  providers: [CronService],
})
export class CronModule {}
