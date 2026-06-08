import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { DeliveryController } from './delivery.controller';
import { CarrierService } from './carriers/carrier.service';

@Module({
  providers: [DeliveryService, CarrierService],
  controllers: [DeliveryController],
  exports: [DeliveryService],
})
export class DeliveryModule {}
