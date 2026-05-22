import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PdfModule } from '../pdf/pdf.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { InvoiceCreatedListener } from './invoice-created.listener';
import { LowStockNotificationListener } from './low-stock-notification.listener';
import { ReminderDueNotificationListener } from './reminder-due-notification.listener';

// Wires every event listener with the modules it needs. EventEmitterModule
// is registered globally in AppModule, so each listener just declares its
// own @OnEvent handlers and Nest takes care of the rest.
//
// Listeners here:
//   - InvoiceCreatedListener             → invoice.created → invoice + QR via WhatsApp
//   - LowStockNotificationListener       → notification.created (LOW_STOCK) → supplier alert
//   - ReminderDueNotificationListener    → notification.created (SYSTEM + reminderId) → customer monthly nudge
@Module({
  imports: [PaymentsModule, PdfModule, WhatsAppModule],
  providers: [
    InvoiceCreatedListener,
    LowStockNotificationListener,
    ReminderDueNotificationListener,
  ],
})
export class EventsModule {}
