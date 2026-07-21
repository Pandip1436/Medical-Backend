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
let idleTimer: NodeJS.Timeout | undefined;
const BROWSER_IDLE_MS = 60_000;

// Recycle the browser after this many pages even while it's still busy. Courier
// sites are ad/tracker-heavy and a long-lived Chromium ratchets RSS upward
// across a "Check All" run; past a few dozen pages on a small host that surfaced
// as net::ERR_INSUFFICIENT_RESOURCES on navigation (Chromium failing to allocate
// sockets/memory) rather than a clean OOM. A periodic fresh start is cheap
// (~1 launch per 25 shipments) and keeps the ceiling flat.
const MAX_PAGES_PER_BROWSER = 25;
let pagesServed = 0;

async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser;
  logger.log('Launching Chromium for courier scraping…');
  browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // Nothing here needs a GPU, extensions, or the background feature
      // machinery; each is a process and a chunk of RSS we're paying for on a
      // host that also runs Node and a second Chromium (the PDF renderer).
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--no-first-run',
    ],
  });
  pagesServed = 0;
  return browser;
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

// Failures that mean "the browser/network hiccupped", not "this courier can't
// be scraped". Each is worth one clean retry on a freshly launched Chromium:
//   • "Navigating frame was detached" — the site replaced the frame mid-load
//     (trackcourier.io swaps the document after its proof-of-work challenge).
//   • ERR_INSUFFICIENT_RESOURCES — Chromium couldn't allocate for the request.
//   • Target/Session/Protocol errors — the tab or the CDP connection died.
const TRANSIENT_RE =
  /frame was detached|ERR_INSUFFICIENT_RESOURCES|ERR_NETWORK_CHANGED|ERR_CONNECTION_(?:RESET|CLOSED|ABORTED|FAILED)|Target closed|Session closed|Protocol error|socket hang up/i;
const MAX_ATTEMPTS = 2;

// Scrapes run one at a time. Chromium is by far the heaviest thing on this host
// and concurrent tabs were how a transient stall turned into resource
// exhaustion; serialising costs nothing real, since "Check All" already walks
// its targets sequentially.
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  // Swallow on the chain itself so one failed scrape doesn't reject the next.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Run `fn` with a fresh page on the shared browser. The page is always closed;
// the browser is kept warm (idle-timer reset) for the next scrape, unless it has
// served enough pages to be worth recycling.
export function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  return serialize(async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await runOnFreshPage(fn);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (attempt >= MAX_ATTEMPTS || !TRANSIENT_RE.test(msg)) throw e;
        logger.warn(
          `scrape attempt ${attempt} failed (${msg}) — recycling Chromium and retrying`,
        );
        // The browser itself is the suspect for every error in TRANSIENT_RE, so
        // retrying on the same instance would just reproduce it.
        await closeScraperBrowser();
        await sleep(1_000);
      }
    }
  });
}

async function runOnFreshPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const b = await getBrowser();
  const page = await b.newPage();
  pagesServed++;
  try {
    await page.setUserAgent(BROWSER_UA);
    await page.setViewport({ width: 1280, height: 900 });
    // Skip images/fonts/media/stylesheets — we only need the DOM text and the
    // site's own XHR, and this makes scrapes noticeably faster and lighter.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      const blocked =
        type === 'image' ||
        type === 'font' ||
        type === 'media' ||
        type === 'stylesheet';
      // Both calls reject if the frame detached or the request was already
      // handled — routine on a page that navigates mid-load. Unhandled, those
      // rejections surfaced as process-level unhandledRejection noise.
      void (blocked ? req.abort() : req.continue()).catch(() => undefined);
    });
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
    if (pagesServed >= MAX_PAGES_PER_BROWSER) {
      logger.log(
        `Recycling Chromium after ${pagesServed} pages to keep memory flat`,
      );
      await closeScraperBrowser();
    } else {
      touchIdleTimer();
    }
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
