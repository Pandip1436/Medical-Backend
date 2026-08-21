import { Module } from '@nestjs/common';
import { InvoicePdfService } from './invoice-pdf.service';
import { ReceiptPdfService } from './receipt-pdf.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [InvoicePdfService, ReceiptPdfService],
  exports: [InvoicePdfService, ReceiptPdfService],
})
export class PdfModule {}
