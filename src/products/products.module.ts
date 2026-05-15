import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { BatchesController } from './batches.controller';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [ApprovalsModule],
  providers: [ProductsService],
  controllers: [ProductsController, BatchesController],
})
export class ProductsModule {}
