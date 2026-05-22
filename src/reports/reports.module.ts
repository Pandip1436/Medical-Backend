import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [CustomersModule],
  providers: [ReportsService],
  controllers: [ReportsController]
})
export class ReportsModule {}
