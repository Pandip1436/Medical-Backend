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
  exports: [LeadsService],
})
export class LeadsModule {}
