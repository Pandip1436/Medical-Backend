import { Module } from '@nestjs/common';
import { JustdialService } from './justdial.service';
import { JustdialController } from './justdial.controller';
import { JustdialWebhookController } from './justdial-webhook.controller';
import { ContactsModule } from '../contacts/contacts.module';
import { LeadsModule } from '../leads/leads.module';
import { NotificationsModule } from '../notifications/notifications.module';

// JustdialModule receives leads in real-time via Just Dial's push/leads API.
// The supplier pastes our webhook URL into their Just Dial Lead Manager, and
// every new lead POSTs straight here. Mirrors IndiamartModule — pure receiver,
// no polling, URL-secret auth.
@Module({
  imports: [ContactsModule, LeadsModule, NotificationsModule],
  controllers: [JustdialController, JustdialWebhookController],
  providers: [JustdialService],
})
export class JustdialModule {}
