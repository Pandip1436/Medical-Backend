import { Module } from '@nestjs/common';
import { InvoicePdfService } from './invoice-pdf.service';
import { ReceiptPdfService } from './receipt-pdf.service';

@Module({
  providers: [InvoicePdfService, ReceiptPdfService],
  exports: [InvoicePdfService, ReceiptPdfService],
})
export class PdfModule {}
