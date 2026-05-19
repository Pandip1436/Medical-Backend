import { Module } from '@nestjs/common';
import { IndiamartService } from './indiamart.service';
import { IndiamartController } from './indiamart.controller';
import { IndiamartWebhookController } from './indiamart-webhook.controller';
import { ContactsModule } from '../contacts/contacts.module';
import { LeadsModule } from '../leads/leads.module';
import { NotificationsModule } from '../notifications/notifications.module';

// IndiamartModule receives leads in real-time via IndiaMART's Push API.
// The seller pastes our webhook URL into their Lead Manager → Push API
// panel, and every new inquiry POSTs straight here (single lead per call).
//
// No polling, no scheduler, no outbound HTTP — purely a receiver. Auth is
// URL secrecy via a 32-byte token in the path, generated server-side per
// branch.
//
// Composition:
//   - ContactsModule       → ContactsService for buyer-side dedup
//   - LeadsModule          → LeadNumberingService for L-XXXX assignment
//   - NotificationsModule  → user-facing alerts on payload failures
@Module({
  imports: [ContactsModule, LeadsModule, NotificationsModule],
  controllers: [IndiamartController, IndiamartWebhookController],
  providers: [IndiamartService],
})
export class IndiamartModule {}
