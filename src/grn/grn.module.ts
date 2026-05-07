import { Module } from '@nestjs/common';
import { GrnService } from './grn.service';
import { GrnController } from './grn.controller';

@Module({
  providers: [GrnService],
  controllers: [GrnController],
})
export class GrnModule {}
