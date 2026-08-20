import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import Handlebars from 'handlebars';
import puppeteer, { Browser } from 'puppeteer';
import * as QRCode from 'qrcode';
import dayjs from 'dayjs';
import { forceCloseBrowser } from '../common/browser/close-browser.util';

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

  /** Printed in the header band, mirroring the client's challan stationery. */
  salespersonName?: string | null;
  /** Stamps "REPLACEMENT - NO CHARGE" across the party band. */
  isReplacement?: boolean;
  /** Business logo as a data URI; omitted when the branch has none. */
  logoDataUri?: string | null;

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
  deliveryCharge?: number;
  additionalCharges?: Array<{ label: string; amount: number }>;
  roundOff: number;
  grandTotal: number;
  amountPaid: number;
  paymentQrShortUrl?: string;   // if provided, embed a QR pointing to this URL
  paymentQrAmount?: number;     // outstanding amount the QR is for
}

// Close the shared Chromium after this long with no renders, so a burst of
// invoices doesn't hold ~300 MB of headless Chrome resident forever. Mirrors
// the courier scraper's idle-shutdown (scrapers/scrape.util.ts) so both browsers
// only exist while actually working — important on small (2 GB) hosts.
const BROWSER_IDLE_MS = 60_000;

// Cap concurrent page renders. Chromium's memory scales with the number of live
// pages, not with the browser process itself, so a caller that fans out — a
// retry sweep, a bulk invoice run — can spike RAM by hundreds of MB per page and
// get the whole process OOM-killed. Renders past this limit queue instead.
// Keep this low: 3 pages is roughly 0.5-0.75 GB of headroom.
const MAX_CONCURRENT_RENDERS = 3;

// How long a queued render may wait for a slot before giving up. Generous
// enough for a full queue of legitimate renders ahead of it, finite so a caller
// can never park here indefinitely — see acquireSlot.
const SLOT_WAIT_MS = 60_000;

@Injectable()
export class InvoicePdfService implements OnModuleDestroy {
  private readonly logger = new Logger(InvoicePdfService.name);
  private browser?: Browser;
  // In-flight launch, shared by every caller that arrives while it's pending —
  // see getBrowser().
  private launching?: Promise<Browser>;
  private idleTimer?: NodeJS.Timeout;
  private compiled?: Handlebars.TemplateDelegate;
  // Mtime the cached template was compiled from — dev-only staleness check.
  private templateMtimeMs?: number;
  // undefined = not read yet, null = absent/unreadable (render without it).
  private logoDataUri?: string | null;
  // Render-slot accounting for MAX_CONCURRENT_RENDERS (see acquireSlot).
  private activeRenders = 0;
  private readonly waiting: Array<() => void> = [];

  constructor() {
    this.registerHelpers();
  }

  // ── Public API — unchanged signature. Returns a PDF Buffer that the
  //    invoice-created listener uploads to R2 and attaches to WhatsApp. ──
  async render(data: InvoicePdfData): Promise<Buffer> {
    // Built before taking a slot — templating and QR generation are cheap and
    // hold no browser resources, so there's no reason to queue behind them.
    const html = await this.renderHtml(data);

    await this.acquireSlot();
    try {
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
        // Keep the browser warm for the next invoice, but arm the idle timer so it
        // gets released after a quiet period instead of sitting resident forever.
        this.touchIdleTimer();
      }
    } finally {
      this.releaseSlot();
    }
  }

  // ── Render-slot semaphore ──
  // Take a slot, or queue until one frees. Waiters are woken FIFO.
  private async acquireSlot(): Promise<void> {
    if (this.activeRenders < MAX_CONCURRENT_RENDERS) {
      this.activeRenders++;
      return;
    }
    // The slot is handed over directly by releaseSlot(), which is why this path
    // doesn't increment: the count already includes the slot we're inheriting.
    //
    // Bounded, because callers upstream now time out: an abandoned caller left
    // parked here forever would still be handed a slot by releaseSlot(), and
    // MAX_CONCURRENT_RENDERS such handovers would wedge PDF rendering for the
    // whole process. On expiry the waiter removes ITSELF from the queue, so the
    // slot goes to a live caller instead.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiting.indexOf(waiter);
        if (i >= 0) this.waiting.splice(i, 1);
        reject(new Error(`PDF render queue wait exceeded ${SLOT_WAIT_MS}ms`));
      }, SLOT_WAIT_MS);
      timer.unref?.();
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waiting.push(waiter);
    });
  }

  // Hand the slot straight to the next waiter rather than decrementing and
  // letting it re-race for it — otherwise a caller arriving in the gap before
  // the woken waiter resumes could push us over the limit.
  private releaseSlot(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.activeRenders--;
  }

  async onModuleDestroy() {
    await this.closeBrowser();
  }

  // Reset the inactivity countdown after each render; when it fires with no
  // renders in between, the browser is closed and its memory reclaimed.
  private touchIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.closeBrowser();
    }, BROWSER_IDLE_MS);
    // Don't keep the Node event loop alive just for this cleanup timer.
    this.idleTimer.unref?.();
  }

  // Closed automatically after BROWSER_IDLE_MS of inactivity, and explicitly on
  // module destroy. Relaunched lazily on the next render via getBrowser().
  private async closeBrowser(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    const b = this.browser;
    // Cleared before the await so a render arriving mid-shutdown launches a
    // fresh browser rather than reusing one that's going away. That handover is
    // exactly why the close must be guaranteed — see forceCloseBrowser.
    this.browser = undefined;
    await forceCloseBrowser(b, this.logger, 'invoice-pdf');
  }

  // ── Build the HTML from the compiled Handlebars template + a view model ──
  private async renderHtml(d: InvoicePdfData): Promise<string> {
    const template = await this.getTemplate();

    const outstanding = round2(Number(d.grandTotal) - Number(d.amountPaid));
    const supplierContact = [
      d.branchPhone ? `Phone: ${d.branchPhone}` : null,
      d.branchEmail ? `E-Mail: ${d.branchEmail}` : null,
    ]
      .filter(Boolean)
      .join('   ');

    let qrDataUri: string | undefined;
    if (d.paymentQrShortUrl) {
      qrDataUri = await QRCode.toDataURL(d.paymentQrShortUrl, { width: 220, margin: 1 });
    }

    const view = {
      ...d,
      // Caller-supplied logo wins; otherwise fall back to the bundled one.
      logoDataUri: d.logoDataUri ?? (await this.getLogoDataUri()),
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
      showDelivery: Number(d.deliveryCharge ?? 0) > 0,
      // User-defined extra charges (Commission, Handling, …). Non-taxable
      // add-ons already folded into grandTotal; shown as their own lines.
      charges: (d.additionalCharges ?? [])
        .filter((c) => c && (c.label ?? '').trim() !== '' && Number(c.amount) !== 0)
        .map((c) => ({ label: c.label.trim(), amount: Number(c.amount) || 0 })),
      showRoundOff: Number(d.roundOff) !== 0,
      showPaid: Number(d.amountPaid) > 0,
      showOutstanding: outstanding > 0.01,
    };

    return template(view);
  }

  // ── Lazy, cached Handlebars compile ──
  // In production the template is compiled once and kept — it cannot change
  // under a running process. In development it can: `nest start --watch`
  // restarts on .ts edits but only *copies* changed .hbs assets, so a cached
  // template silently kept serving the old invoice layout while the file on
  // disk had already changed. Re-compile when the file's mtime moves.
  private async getTemplate(): Promise<Handlebars.TemplateDelegate> {
    const path = this.resolveTemplatePath();
    if (process.env.NODE_ENV === 'production') {
      if (this.compiled) return this.compiled;
    } else {
      const mtime = (await fs.stat(path)).mtimeMs;
      if (this.compiled && mtime === this.templateMtimeMs) return this.compiled;
      this.templateMtimeMs = mtime;
    }
    const src = await fs.readFile(path, 'utf8');
    this.compiled = Handlebars.compile(src);
    return this.compiled;
  }

  // Works both compiled (dist/src/pdf/templates) and under ts-node (src/pdf/templates).
  // Requires the nest-cli.json asset rule that copies *.hbs into dist (see Step 4).
  private resolveTemplatePath(): string {
    return this.resolveAsset('invoice.hbs');
  }

  private resolveAsset(file: string): string {
    const next = join(__dirname, 'templates', file);
    if (existsSync(next)) return next;
    const fallback = join(process.cwd(), 'src', 'pdf', 'templates', file);
    if (existsSync(fallback)) return fallback;
    throw new Error(`${file} not found (looked in ${next} and ${fallback})`);
  }

  // The letterhead logo — the same /logo.png the web app shows in its sidebar,
  // copied alongside the template so the backend doesn't depend on the frontend
  // build. Inlined as a data URI because the render runs on a `setContent` page
  // with no origin, so it cannot fetch anything over the network. Read once and
  // cached: it's ~100 KB and every invoice needs it.
  private async getLogoDataUri(): Promise<string | null> {
    if (this.logoDataUri !== undefined) return this.logoDataUri;
    try {
      const buf = await fs.readFile(this.resolveAsset('logo.png'));
      this.logoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
    } catch (err) {
      // A missing logo must never fail an invoice — the header just renders
      // without it, exactly as it did before the logo existed.
      this.logger.warn(`Invoice logo unavailable, rendering without it: ${String(err)}`);
      this.logoDataUri = null;
    }
    return this.logoDataUri;
  }

  // ── Shared, lazily-launched Chromium. Reused across invoices; relaunched
  //    automatically if it ever disconnects. Closed on module destroy. ──
  // The launch is memoised because `render()` runs up to MAX_CONCURRENT_RENDERS
  // at once: after an idle close (or on a cold first burst) every one of those
  // callers sees `browser` unset in the same tick. Launching per-caller and
  // assigning the field would leave only the last browser referenced — the
  // others become trees that *nothing* holds a handle to, so the idle timer,
  // onModuleDestroy and forceCloseBrowser alike can never close them. That's the
  // ratchet that stranded ~19 Chromium trees / ~190 processes on the host; a
  // guaranteed close is no help when no reference survives to close *through*.
  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (!this.launching) {
      const launch = this.launch();
      this.launching = launch;
      // Clear only our own entry: a later launch may already have superseded
      // this one, and dropping *that* would put us back to launching per-caller.
      void launch
        .catch(() => undefined)
        .finally(() => {
          if (this.launching === launch) this.launching = undefined;
        });
    }
    return this.launching;
  }

  private async launch(): Promise<Browser> {
    this.logger.log('Launching Chromium for PDF rendering…');
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // avoid /dev/shm exhaustion in containers
        '--font-render-hinting=none',
      ],
    });
    this.browser = browser;
    return browser;
  }

  private registerHelpers() {
    // Indian digit grouping, always 2 dp. We prefix "Rs." (not the ₹ glyph):
    // the headless-Chromium fonts available in the PDF environment don't all
    // carry U+20B9, so ₹ rendered as a broken box before every amount. "Rs."
    // is ASCII and renders identically everywhere.
    Handlebars.registerHelper('money', (n: unknown) =>
      'Rs. ' +
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
