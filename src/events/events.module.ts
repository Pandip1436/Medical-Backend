import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { PdfModule } from '../pdf/pdf.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { InvoiceCreatedListener } from './invoice-created.listener';

// Wires the InvoiceCreatedListener with everything it needs. EventEmitterModule
// is registered globally in AppModule.
@Module({
  imports: [PaymentsModule, PdfModule, WhatsAppModule],
  providers: [InvoiceCreatedListener],
})
export class EventsModule {}
