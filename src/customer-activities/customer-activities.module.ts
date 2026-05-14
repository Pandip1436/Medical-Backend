import { Module } from '@nestjs/common';
import { CustomerActivitiesService } from './customer-activities.service';
import { CustomerActivitiesController } from './customer-activities.controller';

@Module({
  providers: [CustomerActivitiesService],
  controllers: [CustomerActivitiesController],
})
export class CustomerActivitiesModule {}
