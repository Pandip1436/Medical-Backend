import { Module } from '@nestjs/common';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchaseReturnsController } from './purchase-returns.controller';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [ApprovalsModule],
  providers: [PurchaseReturnsService],
  controllers: [PurchaseReturnsController],
})
export class PurchaseReturnsModule {}
