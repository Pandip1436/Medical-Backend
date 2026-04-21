import { Module } from '@nestjs/common';
import { SalespersonsController } from './salespersons.controller';
import { SalespersonsService } from './salespersons.service';
import { PrismaModule } from '../prisma/prisma.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PrismaModule, UsersModule],
  controllers: [SalespersonsController],
  providers: [SalespersonsService],
  exports: [SalespersonsService],
})
export class SalespersonsModule {}
