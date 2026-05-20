import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { CustomerImportService } from './customer-import.service';
import { CustomerImportController } from './customer-import.controller';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  // CommonServicesModule (DocumentNumberingService) is @Global, no explicit import needed.
  imports: [ApprovalsModule],
  providers: [CustomersService, CustomerImportService],
  controllers: [CustomersController, CustomerImportController],
})
export class CustomersModule {}
