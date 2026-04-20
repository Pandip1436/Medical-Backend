import { Module } from '@nestjs/common';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchaseReturnsController } from './purchase-returns.controller';

@Module({
  providers: [PurchaseReturnsService],
  controllers: [PurchaseReturnsController],
})
export class PurchaseReturnsModule {}
