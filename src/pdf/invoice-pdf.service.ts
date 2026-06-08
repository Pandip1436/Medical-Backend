import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import Handlebars from 'handlebars';
import puppeteer, { Browser } from 'puppeteer';
import * as QRCode from 'qrcode';
import dayjs from 'dayjs';

export interface InvoicePdfData {
  invoiceNumber: string;
  date: Date;
  dueDate?: Date | string | null;   // credit-sale payment due date

  // ---- Customer (hospital) ----
  customerName: string;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerBranch?: string | null;    // hospital branch / department (optional)
  customerGstin?: string | null;     // optional
  customerDlNumber?: string | null;  // hospital drug-license no (optional)

  // ---- Supplier (the billing branch) ----
  // `branch*` names kept for backward-compat with the existing listener.
  branchName?: string | null;
  branchGstin?: string | null;
  branchAddress?: string | null;
  branchPhone?: string | null;       // optional
  branchEmail?: string | null;       // optional
  branchDlNumber?: string | null;    // supplier drug-license no (optional)

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
  paymentQrShortUrl?: string;   // if provided, embed a QR pointing to this URL
  paymentQrAmount?: number;     // outstanding amount the QR is for
}

@Injectable()
export class InvoicePdfService implements OnModuleDestroy {
  private readonly logger = new Logger(InvoicePdfService.name);
  private browser?: Browser;
  private compiled?: Handlebars.TemplateDelegate;

  constructor() {
    this.registerHelpers();
  }

  // ── Public API — unchanged signature. Returns a PDF Buffer that the
  //    invoice-created listener uploads to R2 and attaches to WhatsApp. ──
  async render(data: InvoicePdfData): Promise<Buffer> {
    const html = await this.renderHtml(data);
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // Everything (CSS + QR) is inlined, so `load` fires immediately — no
      // network round-trips, so the render is fast and deterministic.
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' },
      });
      // page.pdf() returns Uint8Array on newer Puppeteer; normalise to Buffer
      // so the existing R2 upload pipeline keeps working byte-for-byte.
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async onModuleDestroy() {
    await this.browser?.close().catch(() => undefined);
  }

  // ── Build the HTML from the compiled Handlebars template + a view model ──
  private async renderHtml(d: InvoicePdfData): Promise<string> {
    const template = await this.getTemplate();

    const outstanding = round2(Number(d.grandTotal) - Number(d.amountPaid));
    const supplierContact = [d.branchPhone, d.branchEmail].filter(Boolean).join('  •  ');

    let qrDataUri: string | undefined;
    if (d.paymentQrShortUrl) {
      qrDataUri = await QRCode.toDataURL(d.paymentQrShortUrl, { width: 220, margin: 1 });
    }

    const view = {
      ...d,
      supplierName: d.branchName ?? 'Medical Supplier',
      supplierAddress: d.branchAddress,
      supplierGstin: d.branchGstin,
      supplierDlNumber: d.branchDlNumber,
      supplierContact,
      outstanding,
      qrDataUri,
      // Pre-computed visibility flags keep the template free of math/logic.
      showDiscount: Number(d.productDiscount) > 0,
      showCgst: Number(d.cgst) > 0,
      showSgst: Number(d.sgst) > 0,
      showIgst: Number(d.igst) > 0,
      showRoundOff: Number(d.roundOff) !== 0,
      showPaid: Number(d.amountPaid) > 0,
      showOutstanding: outstanding > 0.01,
    };

    return template(view);
  }

  // ── Lazy, cached Handlebars compile ──
  private async getTemplate(): Promise<Handlebars.TemplateDelegate> {
    if (this.compiled) return this.compiled;
    const src = await fs.readFile(this.resolveTemplatePath(), 'utf8');
    this.compiled = Handlebars.compile(src);
    return this.compiled;
  }

  // Works both compiled (dist/src/pdf/templates) and under ts-node (src/pdf/templates).
  // Requires the nest-cli.json asset rule that copies *.hbs into dist (see Step 4).
  private resolveTemplatePath(): string {
    const next = join(__dirname, 'templates', 'invoice.hbs');
    if (existsSync(next)) return next;
    const fallback = join(process.cwd(), 'src', 'pdf', 'templates', 'invoice.hbs');
    if (existsSync(fallback)) return fallback;
    throw new Error(`invoice.hbs not found (looked in ${next} and ${fallback})`);
  }

  // ── Shared, lazily-launched Chromium. Reused across invoices; relaunched
  //    automatically if it ever disconnects. Closed on module destroy. ──
  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    this.logger.log('Launching Chromium for PDF rendering…');
    this.browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // avoid /dev/shm exhaustion in containers
        '--font-render-hinting=none',
      ],
    });
    return this.browser;
  }

  private registerHelpers() {
    // ₹ with Indian digit grouping, always 2 dp.
    Handlebars.registerHelper('money', (n: unknown) =>
      '₹ ' +
      Number(n ?? 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    );
    Handlebars.registerHelper('expiry', (d: unknown) => (d ? dayjs(d as Date).format('MM/YYYY') : '-'));
    Handlebars.registerHelper('day', (d: unknown) => (d ? dayjs(d as Date).format('DD MMM YYYY') : '-'));
    Handlebars.registerHelper('inc', (i: number) => i + 1); // 1-based row numbers
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
