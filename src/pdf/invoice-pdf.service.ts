import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';

export interface InvoicePdfData {
  invoiceNumber: string;
  date: Date;
  dueDate?: Date | string | null;   // credit-sale payment due date
  customerName: string;
  customerPhone?: string | null;
  customerAddress?: string | null;
  branchName?: string | null;
  branchGstin?: string | null;
  branchAddress?: string | null;
  items: Array<{
    productName: string;
    batchNumber: string;
    expiryDate: Date;
    quantity: number;
    mrp: number;
    rate: number;
    discountPercent: number;
    gstPercent: number;
    amount: number;
  }>;
  subtotal: number;
  productDiscount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  grandTotal: number;
  amountPaid: number;
  paymentQrShortUrl?: string;   // if provided, embed a QR pointing to this URL (top-right)
  paymentQrAmount?: number;     // outstanding amount the QR is for
}

@Injectable()
export class InvoicePdfService {
  async render(data: InvoicePdfData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    await this.layout(doc, data);
    doc.end();
    return done;
  }

  private async layout(doc: PDFKit.PDFDocument, d: InvoicePdfData) {
    const pageRight = doc.page.width - doc.page.margins.right;
    const inr = (n: number) => `Rs. ${n.toFixed(2)}`;

    // Header — pharmacy name + GSTIN, QR top-right if there's outstanding
    doc.fontSize(16).font('Helvetica-Bold').text(d.branchName ?? 'Pharmacy', { continued: false });
    doc.fontSize(9).font('Helvetica');
    if (d.branchAddress) doc.text(d.branchAddress, { width: 320 });
    if (d.branchGstin) doc.text(`GSTIN: ${d.branchGstin}`);

    // QR (top-right) — only if there's an outstanding payment URL
    if (d.paymentQrShortUrl) {
      const qrPng = await QRCode.toBuffer(d.paymentQrShortUrl, { width: 120, margin: 1 });
      const qrSize = 110;
      const qrX = pageRight - qrSize;
      const qrY = doc.page.margins.top;
      doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
      doc
        .fontSize(8)
        .fillColor('#444')
        .text('Scan to Pay via UPI', qrX, qrY + qrSize + 2, { width: qrSize, align: 'center' })
        .fillColor('#000');
      if (d.paymentQrAmount && d.paymentQrAmount > 0) {
        doc
          .fontSize(9)
          .font('Helvetica-Bold')
          .text(inr(d.paymentQrAmount), qrX, qrY + qrSize + 14, { width: qrSize, align: 'center' })
          .font('Helvetica');
      }
    }

    doc.moveDown(2);

    // Invoice meta
    doc.fontSize(18).font('Helvetica-Bold').text('TAX INVOICE', { align: 'left' });
    doc.fontSize(10).font('Helvetica');
    doc.text(`Invoice #: ${d.invoiceNumber}`);
    doc.text(`Date: ${new Date(d.date).toLocaleDateString('en-IN')}`);
    if (d.dueDate) doc.text(`Due Date: ${new Date(d.dueDate).toLocaleDateString('en-IN')}`);
    doc.moveDown(0.5);

    // Customer block
    doc.fontSize(10).font('Helvetica-Bold').text('Bill To:');
    doc.font('Helvetica').text(d.customerName);
    if (d.customerPhone) doc.text(d.customerPhone);
    if (d.customerAddress) doc.text(d.customerAddress, { width: 320 });
    doc.moveDown(0.5);

    // Items table — simple grid
    const tableTop = doc.y;
    const cols = [
      { label: 'Item', x: 36, w: 170 },
      { label: 'Batch', x: 206, w: 60 },
      { label: 'Expiry', x: 266, w: 50 },
      { label: 'Qty', x: 316, w: 30 },
      { label: 'Rate', x: 346, w: 55 },
      { label: 'Disc%', x: 401, w: 35 },
      { label: 'GST%', x: 436, w: 35 },
      { label: 'Amount', x: 471, w: 88 },
    ];
    doc.font('Helvetica-Bold').fontSize(9);
    for (const c of cols) doc.text(c.label, c.x, tableTop, { width: c.w });
    doc
      .moveTo(36, tableTop + 12)
      .lineTo(pageRight, tableTop + 12)
      .stroke();

    let y = tableTop + 16;
    doc.font('Helvetica').fontSize(9);
    for (const item of d.items) {
      doc.text(item.productName, cols[0].x, y, { width: cols[0].w });
      doc.text(item.batchNumber, cols[1].x, y, { width: cols[1].w });
      doc.text(new Date(item.expiryDate).toLocaleDateString('en-IN', { year: '2-digit', month: 'short' }), cols[2].x, y, { width: cols[2].w });
      doc.text(String(item.quantity), cols[3].x, y, { width: cols[3].w });
      doc.text(Number(item.rate).toFixed(2), cols[4].x, y, { width: cols[4].w });
      doc.text(Number(item.discountPercent).toFixed(1), cols[5].x, y, { width: cols[5].w });
      doc.text(Number(item.gstPercent).toFixed(1), cols[6].x, y, { width: cols[6].w });
      doc.text(inr(Number(item.amount)), cols[7].x, y, { width: cols[7].w, align: 'right' });
      y += 14;
      if (y > doc.page.height - 180) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    }

    doc
      .moveTo(36, y + 2)
      .lineTo(pageRight, y + 2)
      .stroke();

    // Totals (right-aligned block)
    const totalsX = 380;
    const valuesX = 480;
    y += 10;
    const row = (label: string, value: number, bold = false) => {
      if (bold) doc.font('Helvetica-Bold');
      doc.text(label, totalsX, y, { width: 100 });
      doc.text(inr(value), valuesX, y, { width: 80, align: 'right' });
      if (bold) doc.font('Helvetica');
      y += 14;
    };
    row('Subtotal', Number(d.subtotal));
    if (Number(d.productDiscount) > 0) row('Discount', -Number(d.productDiscount));
    row('Taxable', Number(d.taxableAmount));
    row('CGST', Number(d.cgst));
    row('SGST', Number(d.sgst));
    if (Number(d.igst) > 0) row('IGST', Number(d.igst));
    if (Number(d.roundOff) !== 0) row('Round Off', Number(d.roundOff));
    row('Grand Total', Number(d.grandTotal), true);
    if (Number(d.amountPaid) > 0) row('Paid', Number(d.amountPaid));
    const outstanding = Number(d.grandTotal) - Number(d.amountPaid);
    if (outstanding > 0.01) row('Outstanding', outstanding, true);

    // Footer note
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor('#666')
      .text(
        'This is a computer-generated invoice. For payment, scan the UPI QR above or contact the pharmacy.',
        36,
        doc.page.height - 50,
        { width: pageRight - 36, align: 'center' },
      )
      .fillColor('#000');
  }
}
