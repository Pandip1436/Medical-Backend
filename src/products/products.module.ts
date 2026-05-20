import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { BatchesController } from './batches.controller';
import { ProductImportService } from './product-import.service';
import { ProductImportController } from './product-import.controller';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [ApprovalsModule],
  providers: [ProductsService, ProductImportService],
  controllers: [ProductsController, BatchesController, ProductImportController],
})
export class ProductsModule {}
