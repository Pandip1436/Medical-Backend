import { Module, forwardRef } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CreditNotesModule } from '../credit-notes/credit-notes.module';
import { PartyLinkModule } from '../party-link/party-link.module';
import { GrnModule } from '../grn/grn.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  // forwardRef: CreditNotesModule + GrnModule + SuppliersModule all import
  // ApprovalsModule too (CN create files a SALES_RETURN approval, a near-expiry
  // Purchase Entry files a PURCHASE_ENTRY approval, an inventory-manager supplier
  // files a NEW_SUPPLIER approval); the approval executor creates the CN/GRN/supplier.
  imports: [
    PrismaModule,
    forwardRef(() => CreditNotesModule),
    forwardRef(() => GrnModule),
    forwardRef(() => SuppliersModule),
    PartyLinkModule,
    SettingsModule,
  ],
  providers: [ApprovalsService],
  controllers: [ApprovalsController],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
