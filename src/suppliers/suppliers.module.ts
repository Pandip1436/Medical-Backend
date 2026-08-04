import { Module } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { SupplierImportService } from './supplier-import.service';
import { SupplierImportController } from './supplier-import.controller';
import { PartyLinkModule } from '../party-link/party-link.module';

@Module({
  // CommonServicesModule (DocumentNumberingService) is @Global, no explicit import needed.
  imports: [PartyLinkModule],
  providers: [SuppliersService, SupplierImportService],
  controllers: [SuppliersController, SupplierImportController],
})
export class SuppliersModule {}
