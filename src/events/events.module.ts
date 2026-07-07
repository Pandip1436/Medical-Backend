import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PdfModule } from '../pdf/pdf.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { InvoiceCreatedListener } from './invoice-created.listener';
import { LowStockNotificationListener } from './low-stock-notification.listener';
import { ReminderDueNotificationListener } from './reminder-due-notification.listener';
import { PaymentReceivedListener } from './payment-received.listener';

// Wires every event listener with the modules it needs. EventEmitterModule
// is registered globally in AppModule, so each listener just declares its
// own @OnEvent handlers and Nest takes care of the rest.
//
// Listeners here:
//   - InvoiceCreatedListener             → invoice.created → invoice + QR via WhatsApp (credit)
//                                           OR emits payment.received (fully paid at counter)
//   - PaymentReceivedListener            → payment.received → receipt PDF + WhatsApp confirmation
//   - LowStockNotificationListener       → notification.created (LOW_STOCK) → supplier alert
//   - ReminderDueNotificationListener    → notification.created (SYSTEM + reminderId) → customer monthly nudge
@Module({
  imports: [PaymentsModule, PdfModule, WhatsAppModule],
  providers: [
    InvoiceCreatedListener,
    PaymentReceivedListener,
    LowStockNotificationListener,
    ReminderDueNotificationListener,
  ],
  // InvoiceCreatedListener is exported so BillingService can call .handle()
  // directly for the manual "Send WhatsApp" button — emitAsync() does NOT
  // actually wait for @OnEvent({async:true}) listeners to finish (confirmed:
  // it resolves in ~1ms while the real send takes several seconds), so a
  // caller that needs the real outcome must invoke the listener directly
  // rather than going through the event bus.
  exports: [InvoiceCreatedListener],
})
export class EventsModule {}
