import { Logger } from '@nestjs/common';
import puppeteer, { Browser, Page } from 'puppeteer';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { DeliveryStatus } from '@prisma/client';
import { ScrapedEvent } from './scrape.types';
import { forceCloseBrowser } from '../../../common/browser/close-browser.util';

dayjs.extend(customParseFormat);

const logger = new Logger('CourierScraper');

// A desktop browser UA — several courier sites short-circuit or block obvious
// bot/`node` user-agents, so we present as a normal Chrome.
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── Shared headless browser ─────────────────────────────────────────────────
// JS-heavy courier sites (DTDC, Trackon, Gati, Professional) only render their
// tracking table after client-side scripts run, so we drive a real Chromium.
// The instance is launched lazily and reused across scrapes (e.g. a "Check All"
// burst), then auto-closed after a period of inactivity so we don't hold
// Chromium open forever. Launch args mirror InvoicePdfService for parity with
// the existing PDF pipeline (container-safe: --no-sandbox, --disable-dev-shm).
let browser: Browser | undefined;
// In-flight launch, shared by every scrape that arrives while it's pending —
// see getBrowser().
let launching: Promise<Browser> | undefined;
let idleTimer: NodeJS.Timeout | undefined;
const BROWSER_IDLE_MS = 60_000;

// The launch is memoised because a "Check All" burst calls withPage() many times
// concurrently: they all see `browser` unset in the same tick, and launching
// per-caller would leave only the last one referenced by the module. Every other
// Chromium tree would then be unreachable — no idle timer, no module-destroy
// hook and no forceCloseBrowser can close a browser nothing holds a handle to.
async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser;
  if (!launching) {
    const launch = launchBrowser();
    launching = launch;
    // Clear only our own entry, so a launch that already superseded this one
    // (e.g. after an idle close mid-flight) isn't dropped from under its waiters.
    void launch
      .catch(() => undefined)
      .finally(() => {
        if (launching === launch) launching = undefined;
      });
  }
  return launching;
}

async function launchBrowser(): Promise<Browser> {
  logger.log('Launching Chromium for courier scraping…');
  const b = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  browser = b;
  return b;
}

function touchIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void closeScraperBrowser();
  }, BROWSER_IDLE_MS);
  // Don't keep the Node event loop alive just for this cleanup timer.
  idleTimer.unref?.();
}

// Closed explicitly on module destroy (see CarrierService) and automatically
// after BROWSER_IDLE_MS of inactivity.
export async function closeScraperBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  const b = browser;
  // Cleared before the await so a scrape arriving mid-shutdown launches a fresh
  // browser instead of reusing one that's going away. That handover is why the
  // close has to be guaranteed rather than best-effort — see forceCloseBrowser.
  browser = undefined;
  await forceCloseBrowser(b, logger, 'courier-scraper');
}

// Run `fn` with a fresh page on the shared browser. The page is always closed;
// the browser is kept warm (idle-timer reset) for the next scrape.
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setUserAgent(BROWSER_UA);
    await page.setViewport({ width: 1280, height: 900 });
    // Skip images/fonts/media — we only need the DOM text, and this makes
    // scrapes noticeably faster and lighter.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (type === 'image' || type === 'font' || type === 'media') {
        void req.abort();
      } else {
        void req.continue();
      }
    });
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
    touchIdleTimer();
  }
}

// ─── Lightweight HTTP fetch (for sites that don't need a browser) ─────────────
export interface HttpResponse {
  ok: boolean;
  status: number;
  text: string;
  // Raw set-cookie values, so a follow-up request can carry the session.
  setCookie: string[];
}

export async function httpRequest(
  url: string,
  init?: RequestInit & { cookie?: string },
): Promise<HttpResponse> {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: 'text/html,application/json,*/*',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.cookie) headers['Cookie'] = init.cookie;
  const resp = await fetch(url, { ...init, headers });
  const text = await resp.text().catch(() => '');
  // node-fetch/undici expose multiple Set-Cookie via getSetCookie().
  const setCookie =
    (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    [];
  return { ok: resp.ok, status: resp.status, text, setCookie };
}

// Reduce raw Set-Cookie headers to a single "k=v; k2=v2" Cookie header value.
export function cookieHeader(setCookie: string[]): string {
  return setCookie
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

// ─── HTML parsing (no cheerio dependency — regex over the markup) ─────────────
const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

export function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract every <table> as an array of rows, each row an array of cell texts.
// Returned flattened across all tables on the page — callers filter to the rows
// that actually look like tracking scans via rowsToEvents().
export function parseHtmlTableRows(html: string): string[][] {
  const rows: string[][] = [];
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html))) {
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[0]))) {
      cells.push(stripTags(cellMatch[1]));
    }
    if (cells.some((c) => c.length > 0)) rows.push(cells);
  }
  return rows;
}

// ─── Date parsing ────────────────────────────────────────────────────────────
// Indian courier sites use a wide spread of date formats. Try the common ones
// explicitly (day-first), then fall back to the native parser.
const DATE_FORMATS = [
  // 12-hour with AM/PM (ST Courier: "04-06-2026 6:33 PM").
  'DD-MM-YYYY h:mm:ss A', 'DD-MM-YYYY h:mm A', 'DD-MM-YYYY hh:mm A',
  'DD/MM/YYYY h:mm:ss A', 'DD/MM/YYYY h:mm A', 'DD/MM/YYYY hh:mm A',
  // 24-hour.
  'DD-MM-YYYY HH:mm:ss', 'DD-MM-YYYY HH:mm', 'DD-MM-YYYY',
  'DD/MM/YYYY HH:mm:ss', 'DD/MM/YYYY HH:mm', 'DD/MM/YYYY',
  'DD.MM.YYYY HH:mm', 'DD.MM.YYYY',
  'DD-MMM-YYYY h:mm:ss A', 'DD-MMM-YYYY h:mm A', 'DD-MMM-YYYY hh:mm A',
  'DD-MMM-YYYY HH:mm:ss', 'DD-MMM-YYYY HH:mm', 'DD-MMM-YYYY',
  'DD MMM YYYY HH:mm:ss', 'DD MMM YYYY HH:mm', 'DD MMM YYYY',
  'MMM DD, YYYY HH:mm', 'MMM DD YYYY', 'MMM DD, YYYY',
  'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD',
];

export function parseDateTime(text?: string | null): Date | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return undefined;
  const d = dayjs(cleaned, DATE_FORMATS, true);
  if (d.isValid()) {
    // Indian courier sites print local (IST) wall-clock times with no timezone
    // marker. Pin them to +05:30 so the resulting instant is correct no matter
    // what timezone the backend process runs in (dev IST vs. prod UTC).
    return new Date(`${d.format('YYYY-MM-DDTHH:mm:ss')}+05:30`);
  }
  const native = new Date(cleaned);
  return isNaN(native.getTime()) ? undefined : native;
}

// True when a cell looks like it contains a date (used to pick the date column
// and to skip header rows).
const DATE_HINT =
  /\b\d{1,2}[-/.\s](?:\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-/.\s]\d{2,4}\b/i;

export function looksLikeDate(text: string): boolean {
  return DATE_HINT.test(text) && !!parseDateTime(text);
}

// ─── Status text → DeliveryStatus ────────────────────────────────────────────
// Ordered most-specific → least. Each entry's regex is tested against the
// lower-cased status text; the first hit wins. Terminal/explicit states are
// checked before the broad "in transit" buckets.
const STATUS_RULES: { re: RegExp; status: DeliveryStatus }[] = [
  { re: /\b(rto|return to origin|returned|return\b)/i, status: 'RETURNED' },
  { re: /\bdelivered\b|delivery successful|consignment delivered/i, status: 'DELIVERED' },
  { re: /out for delivery|out for del|with delivery (boy|agent)|reached for delivery/i, status: 'OUT_FOR_DELIVERY' },
  { re: /undelivered|delivery attempt|not delivered|attempt fail/i, status: 'OUT_FOR_DELIVERY' },
  { re: /reached|arrived|received at|in-?scan|bag(ged|ging)? (at|in)|at (hub|facility|destination)|hub|facility/i, status: 'ARRIVED_AT_HUB' },
  { re: /picked up|pickup done|pickup complete|out-?scan|dispatch|departed|forwarded|connected|bag connected|left (origin|from)/i, status: 'DISPATCHED' },
  { re: /booked|consignment booked|shipment booked|data received|soft ?data|manifest|pickup (awaited|scheduled|request)|order placed|label created|info received/i, status: 'BOOKED' },
  { re: /in[- ]?transit|in transit|shipment in transit|on the way|movement/i, status: 'IN_TRANSIT' },
];

// Map a free-text courier status to our DeliveryStatus. Unknown phrasing
// defaults to IN_TRANSIT (a safe "something happened, still moving" bucket).
export function mapStatusText(text: string): DeliveryStatus {
  const t = (text || '').toLowerCase();
  for (const { re, status } of STATUS_RULES) {
    if (re.test(t)) return status;
  }
  return 'IN_TRANSIT';
}

// True when the text matches an *explicit* status phrase (not the IN_TRANSIT
// fallback) — used to pick the status column out of an ambiguous table row.
export function isKnownStatusPhrase(text: string): boolean {
  const t = (text || '').toLowerCase();
  return STATUS_RULES.some(({ re }) => re.test(t));
}

// ─── Generic row → event heuristic ───────────────────────────────────────────
// Courier tables vary wildly in column count/order. Rather than hard-code each
// layout, we treat every data row as a bag of cells and pick:
//   • occurredAt  → the first cell that parses as a date
//   • statusText  → the cell matching a known status phrase (else the longest
//                   non-date, non-location cell)
//   • location    → a remaining text cell that isn't the status
// Rows without a parseable date are dropped (headers, footers, totals).
export function rowsToEvents(rows: string[][], context?: string): ScrapedEvent[] {
  const events: ScrapedEvent[] = [];
  for (const row of rows) {
    const cells = row.map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    const dateIdx = cells.findIndex(looksLikeDate);
    if (dateIdx === -1) continue;
    const occurredAt = parseDateTime(cells[dateIdx]);
    if (!occurredAt) continue;

    const rest = cells.filter((_, i) => i !== dateIdx);
    const statusCell =
      rest.find(isKnownStatusPhrase) ??
      [...rest].sort((a, b) => b.length - a.length)[0];
    const location = rest.find(
      (c) => c !== statusCell && /[a-z]/i.test(c) && !isKnownStatusPhrase(c),
    );
    const note = rest.join(' — ');

    events.push({
      statusText: statusCell ?? note,
      location: location && location !== statusCell ? location : undefined,
      occurredAt,
      note: note !== (statusCell ?? '') ? note : undefined,
    });
  }
  if (context && events.length === 0) {
    logger.debug(`${context}: no scan rows parsed from ${rows.length} table rows`);
  }
  return events;
}

// ─── Generic browser-driven scrape ───────────────────────────────────────────
// Most Indian courier sites render their tracking table only after client-side
// scripts run, so we drive Chromium. This routine covers the common shape:
// open the tracking page, (optionally) type the AWB into an input and submit,
// wait for results, then harvest every <table> on the page as rows and run the
// generic rows→events heuristic. Per-courier scrapers just supply selectors.
export interface BrowserScrapeOpts {
  slug: string;
  // Page to open. If it contains the token `{awb}` it's treated as a
  // direct-link tracker (token substituted; no form-fill attempted).
  url: string;
  trackingNumber: string;
  // CSS selector for the AWB input (when the URL isn't a direct link).
  inputSelector?: string;
  // CSS selector for the submit/track button; if omitted we press Enter.
  submitSelector?: string;
  // Selector to wait for after submit (the results table/container). If omitted
  // we wait for the network to go idle.
  resultSelector?: string;
}

export async function scrapeViaBrowser(
  opts: BrowserScrapeOpts,
): Promise<ScrapedEvent[]> {
  return withPage(async (page) => {
    const direct = opts.url.includes('{awb}');
    const url = direct
      ? opts.url.replace('{awb}', encodeURIComponent(opts.trackingNumber))
      : opts.url;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (!direct && opts.inputSelector) {
      await page.waitForSelector(opts.inputSelector, { timeout: 15_000 });
      await page.type(opts.inputSelector, opts.trackingNumber, { delay: 20 });
      if (opts.submitSelector) {
        await page.click(opts.submitSelector).catch(() => undefined);
      } else {
        await page.keyboard.press('Enter');
      }
    }

    if (opts.resultSelector) {
      await page
        .waitForSelector(opts.resultSelector, { timeout: 20_000 })
        .catch(() => undefined);
    } else {
      await page
        .waitForNetworkIdle({ idleTime: 1_200, timeout: 20_000 })
        .catch(() => undefined);
    }

    // Harvest every table on the page as raw cell-text rows (runs in the page).
    const rows = (await page.evaluate(() => {
      const out: string[][] = [];
      document.querySelectorAll('table').forEach((table) => {
        table.querySelectorAll('tr').forEach((tr) => {
          const cells = Array.from(tr.querySelectorAll('td,th')).map((c) =>
            (c.textContent || '').replace(/\s+/g, ' ').trim(),
          );
          if (cells.some((c) => c.length > 0)) out.push(cells);
        });
      });
      return out;
    })) as string[][];

    return rowsToEvents(rows, opts.slug);
  });
}

export { logger as scraperLogger };
