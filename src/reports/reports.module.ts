import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { CustomersModule } from '../customers/customers.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [CustomersModule, SettingsModule],
  providers: [ReportsService],
  controllers: [ReportsController]
})
export class ReportsModule {}
