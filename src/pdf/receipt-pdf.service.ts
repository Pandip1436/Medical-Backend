import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface ReceiptPdfData {
  receiptNumber: string;
  invoiceNumber: string;
  date: Date;
  customerName: string;
  amount: number;
  paymentMode: string;
  referenceNumber?: string | null;
  branchName?: string | null;
  remainingOutstanding?: number;
}

// Payment receipt — sent on WhatsApp after a successful payment is reconciled.
// Kept intentionally tiny: this is a transactional confirmation, not the
// original GST invoice (which never gets regenerated after creation).
@Injectable()
export class ReceiptPdfService {
  async render(d: ReceiptPdfData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A5', margin: 28 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const inr = (n: number) => `Rs. ${n.toFixed(2)}`;
    doc.fontSize(14).font('Helvetica-Bold').text(d.branchName ?? 'Pharmacy');
    doc.moveDown(0.3);
    doc.fontSize(16).text('Payment Receipt', { underline: true });
    doc.moveDown(0.6);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Receipt #: ${d.receiptNumber}`);
    doc.text(`Invoice #: ${d.invoiceNumber}`);
    doc.text(`Date: ${new Date(d.date).toLocaleString('en-IN')}`);
    doc.text(`Customer: ${d.customerName}`);
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica-Bold').text(`Amount Received: ${inr(Number(d.amount))}`);
    doc.font('Helvetica').fontSize(10);
    doc.text(`Mode: ${d.paymentMode}`);
    if (d.referenceNumber) doc.text(`Reference: ${d.referenceNumber}`);
    if (typeof d.remainingOutstanding === 'number' && d.remainingOutstanding > 0.01) {
      doc.moveDown(0.3);
      doc.text(`Remaining Outstanding: ${inr(d.remainingOutstanding)}`);
    } else if (typeof d.remainingOutstanding === 'number') {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('Invoice Fully Paid — Thank You!');
    }
    doc.end();
    return done;
  }
}
