import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
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
import { NumberingModule } from './numbering/numbering.module';
import { BackupModule } from './backups/backup.module';
import { QuotationsModule } from './quotations/quotations.module';
import { CategoriesModule } from './categories/categories.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RemindersModule } from './reminders/reminders.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { SupplierActivitiesModule } from './supplier-activities/supplier-activities.module';
import { CustomerActivitiesModule } from './customer-activities/customer-activities.module';
import { SharedFilesModule } from './shared-files/shared-files.module';
import { CompaniesModule } from './companies/companies.module';
import { ContactsModule } from './contacts/contacts.module';
import { LeadsModule } from './leads/leads.module';
import { LeadActivitiesModule } from './lead-activities/lead-activities.module';
import { IndiamartModule } from './indiamart/indiamart.module';
import { JustdialModule } from './justdial/justdial.module';
import { CommonServicesModule } from './common/services/common-services.module';
import { PaymentsModule } from './payments/payments.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { CronModule } from './cron/cron.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PdfModule } from './pdf/pdf.module';
import { PublicPayModule } from './public-pay/public-pay.module';
import { DeliveryModule } from './delivery/delivery.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
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
    NumberingModule,
    BackupModule,
    QuotationsModule,
    CategoriesModule,
    NotificationsModule,
    RemindersModule,
    ApprovalsModule,
    SupplierActivitiesModule,
    CustomerActivitiesModule,
    SharedFilesModule,
    CompaniesModule,
    ContactsModule,
    LeadsModule,
    LeadActivitiesModule,
    IndiamartModule,
    JustdialModule,
    PdfModule,
    PaymentsModule,
    WhatsAppModule,
    CronModule,
    WebhooksModule,
    PublicPayModule,
    DeliveryModule,
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
