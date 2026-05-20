import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NumberingController } from './numbering.controller';
import { NumberingService } from './numbering.service';

@Module({
  imports: [PrismaModule],
  controllers: [NumberingController],
  providers: [NumberingService],
})
export class NumberingModule {}
