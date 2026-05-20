import { Module } from '@nestjs/common';
import { PublicPayController } from './public-pay.controller';
import { PublicPayService } from './public-pay.service';

@Module({
  controllers: [PublicPayController],
  providers: [PublicPayService],
})
export class PublicPayModule {}
