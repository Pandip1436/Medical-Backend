import { Module, forwardRef } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { SupplierImportService } from './supplier-import.service';
import { SupplierImportController } from './supplier-import.controller';
import { PartyLinkModule } from '../party-link/party-link.module';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  // CommonServicesModule (DocumentNumberingService) is @Global, no explicit import needed.
  // forwardRef: ApprovalsModule imports SuppliersModule too — an inventory-manager
  // "new supplier" files a NEW_SUPPLIER approval (SuppliersService → ApprovalsService),
  // and the approval executor creates the supplier (ApprovalsService → SuppliersService).
  imports: [PartyLinkModule, forwardRef(() => ApprovalsModule)],
  providers: [SuppliersService, SupplierImportService],
  controllers: [SuppliersController, SupplierImportController],
  exports: [SuppliersService],
})
export class SuppliersModule {}
