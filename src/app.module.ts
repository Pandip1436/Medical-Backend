import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { CustomersModule } from './customers/customers.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { ProductsModule } from './products/products.module';
import { BillingModule } from './billing/billing.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { GrnModule } from './grn/grn.module';
import { ReportsModule } from './reports/reports.module';
import { CreditNotesModule } from './credit-notes/credit-notes.module';
import { PurchaseReturnsModule } from './purchase-returns/purchase-returns.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';
import { PrescriptionsModule } from './prescriptions/prescriptions.module';
import { ExpensesModule } from './expenses/expenses.module';
import { DoctorsModule } from './doctors/doctors.module';
import { BranchesModule } from './branches/branches.module';
import { SalespersonsModule } from './salespersons/salespersons.module';
import { SettingsModule } from './settings/settings.module';
import { QuotationsModule } from './quotations/quotations.module';
import { CategoriesModule } from './categories/categories.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RemindersModule } from './reminders/reminders.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { CommonServicesModule } from './common/services/common-services.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    AuthModule,
    PrismaModule,
    CommonServicesModule,
    UsersModule,
    CustomersModule,
    SuppliersModule,
    ProductsModule,
    BillingModule,
    PurchaseOrdersModule,
    GrnModule,
    ReportsModule,
    CreditNotesModule,
    PurchaseReturnsModule,
    AuditLogsModule,
    PrescriptionsModule,
    ExpensesModule,
    DoctorsModule,
    BranchesModule,
    SalespersonsModule,
    SettingsModule,
    QuotationsModule,
    CategoriesModule,
    NotificationsModule,
    RemindersModule,
    ApprovalsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class AppModule {}
