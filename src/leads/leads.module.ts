import { Module } from '@nestjs/common';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { LeadNumberingService } from './lead-numbering.service';
import { LeadsAnalyticsService } from './leads-analytics.service';
import { LeadsAnalyticsController } from './leads-analytics.controller';
import { ContactsModule } from '../contacts/contacts.module';

@Module({
  imports: [ContactsModule],
  providers: [LeadsService, LeadNumberingService, LeadsAnalyticsService],
  controllers: [LeadsController, LeadsAnalyticsController],
  // LeadNumberingService is exported so the IndiaMART sync (in IndiamartModule)
  // can generate L-XXXX numbers for auto-imported leads without duplicating
  // the document-sequence logic.
  exports: [LeadsService, LeadNumberingService],
})
export class LeadsModule {}
