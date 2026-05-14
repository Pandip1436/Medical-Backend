import { Module } from '@nestjs/common';
import { SupplierActivitiesService } from './supplier-activities.service';
import { SupplierActivitiesController } from './supplier-activities.controller';

@Module({
  providers: [SupplierActivitiesService],
  controllers: [SupplierActivitiesController],
})
export class SupplierActivitiesModule {}
