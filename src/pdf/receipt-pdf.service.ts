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
    const doc = new PDFDocument({ size: 'A5', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // ── Layout + palette ──────────────────────────────────────────────
    const W = doc.page.width; // A5 ≈ 419.5pt
    const H = doc.page.height;
    const PAD = 34;
    const CW = W - PAD * 2;
    // Rs. (not ₹): the PDFKit built-in fonts lack the rupee glyph.
    const inr = (n: number) =>
      `Rs. ${Number(n || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

    const BRAND = '#e11d48';
    const BRAND_DK = '#be123c';
    const INK = '#111827';
    const MUTED = '#6b7280';
    const LINE = '#e5e7eb';
    const LIGHT = '#f9fafb';
    const GREEN = '#059669';
    const AMBER = '#d97706';

    const rem = d.remainingOutstanding;
    const fullPaid = typeof rem === 'number' && rem <= 0.01;
    const partial = typeof rem === 'number' && rem > 0.01;

    // ── Header band ───────────────────────────────────────────────────
    const HEAD_H = 100;
    doc.rect(0, 0, W, HEAD_H).fill(BRAND);
    doc.rect(0, HEAD_H - 5, W, 5).fill(BRAND_DK);
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(d.branchName ?? 'Pharmacy', PAD, 26, { width: CW });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#ffe4e6')
      .text('PAYMENT RECEIPT', PAD, 48, { characterSpacing: 3 });
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#ffffff')
      .text(d.receiptNumber, PAD, 68, { width: CW });

    let y = HEAD_H + 24;

    // ── Status pill ───────────────────────────────────────────────────
    const status = fullPaid
      ? 'PAID IN FULL'
      : partial
        ? 'PARTIAL PAYMENT'
        : 'PAYMENT RECEIVED';
    const statusColor = fullPaid ? GREEN : partial ? AMBER : BRAND;
    doc.font('Helvetica-Bold').fontSize(8);
    const pillW = doc.widthOfString(status) + 12 + 20;
    doc.roundedRect(PAD, y, pillW, 19, 9.5).fill(statusColor);
    doc
      .fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(status, PAD + 10, y + 6, { characterSpacing: 1 });
    y += 36;

    // ── Info grid (2 columns) ─────────────────────────────────────────
    const col2X = PAD + CW / 2;
    const colW = CW / 2 - 8;
    const infoRow = (
      l1: string,
      v1: string,
      l2?: string,
      v2?: string,
    ) => {
      doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(l1.toUpperCase(), PAD, y, { characterSpacing: 0.5 });
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(v1, PAD, y + 11, { width: colW });
      if (l2) {
        doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(l2.toUpperCase(), col2X, y, { characterSpacing: 0.5 });
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(v2 ?? '—', col2X, y + 11, { width: colW });
      }
      y += 36;
    };
    infoRow('Invoice #', d.invoiceNumber, 'Date', new Date(d.date).toLocaleString('en-IN'));
    infoRow('Customer', d.customerName, 'Payment Mode', d.paymentMode);

    doc.moveTo(PAD, y).lineTo(PAD + CW, y).lineWidth(1).strokeColor(LINE).stroke();
    y += 20;

    // ── Amount card ───────────────────────────────────────────────────
    const cardH = 66;
    doc.roundedRect(PAD, y, CW, cardH, 12).fill(LIGHT);
    doc.roundedRect(PAD, y, CW, cardH, 12).lineWidth(1).strokeColor(LINE).stroke();
    doc.rect(PAD, y + 10, 4, cardH - 20).fill(fullPaid ? GREEN : BRAND);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text('AMOUNT RECEIVED', PAD + 20, y + 15, { characterSpacing: 1.5 });
    doc
      .font('Helvetica-Bold')
      .fontSize(23)
      .fillColor(INK)
      .text(inr(d.amount), PAD + 18, y + 28);
    y += cardH + 22;

    // ── Reference ─────────────────────────────────────────────────────
    if (d.referenceNumber) {
      doc.font('Helvetica').fontSize(7).fillColor(MUTED).text('REFERENCE', PAD, y, { characterSpacing: 0.5 });
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(d.referenceNumber, PAD, y + 11, { width: CW });
      y += 32;
    }

    // ── Balance line ──────────────────────────────────────────────────
    if (partial) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(AMBER).text(`Remaining Outstanding: ${inr(rem)}`, PAD, y);
    } else if (fullPaid) {
      doc.font('Helvetica-Bold').fontSize(12).fillColor(GREEN).text('Invoice fully paid — thank you!', PAD, y);
    }

    // ── Footer ────────────────────────────────────────────────────────
    const footY = H - 42;
    doc.moveTo(PAD, footY).lineTo(PAD + CW, footY).lineWidth(1).strokeColor(LINE).stroke();
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(MUTED)
      .text('This is a computer-generated receipt and does not require a signature.', PAD, footY + 9, {
        width: CW,
        align: 'center',
      });

    doc.end();
    return done;
  }
}
