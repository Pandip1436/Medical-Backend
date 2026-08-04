import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PartyLinkService } from './party-link.service';

/**
 * Shared module that maintains the wholesale-customer ↔ supplier twin link.
 * Kept in its own module (depending only on Prisma) so both CustomersModule and
 * SuppliersModule — and ApprovalsModule — can import it without a circular
 * dependency.
 */
@Module({
  imports: [PrismaModule],
  providers: [PartyLinkService],
  exports: [PartyLinkService],
})
export class PartyLinkModule {}
