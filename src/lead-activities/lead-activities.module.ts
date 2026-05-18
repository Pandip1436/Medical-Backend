import { Module } from '@nestjs/common';
import { LeadActivitiesService } from './lead-activities.service';
import { LeadActivitiesController } from './lead-activities.controller';

@Module({
  providers: [LeadActivitiesService],
  controllers: [LeadActivitiesController],
})
export class LeadActivitiesModule {}
