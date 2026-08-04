import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { CustomerImportService } from './customer-import.service';
import { CustomerImportController } from './customer-import.controller';
import { ApprovalsModule } from '../approvals/approvals.module';
import { PartyLinkModule } from '../party-link/party-link.module';

@Module({
  // CommonServicesModule (DocumentNumberingService) is @Global, no explicit import needed.
  imports: [ApprovalsModule, PartyLinkModule],
  providers: [CustomersService, CustomerImportService],
  controllers: [CustomersController, CustomerImportController],
  exports: [CustomersService],
})
export class CustomersModule {}
