import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DeliveryStatus } from '@prisma/client';
import {
  CarrierProvider,
  CarrierTrackingResult,
  NormalizedCheckpoint,
} from './carrier.types';
import { withPage, parseDateTime, mapStatusText } from './scrapers/scrape.util';

// ─── trackcourier.io web-scraping provider ───────────────────────────────────
// A zero-config CarrierProvider that pulls tracking from the public aggregator
// trackcourier.io, which already tracks 170+ couriers server-side — INCLUDING
// the ones whose own sites are CAPTCHA-walled (DTDC, The Professional Couriers,
// Gati). So this gives multi-courier coverage with no API key and no captcha.
//
// How it works: the site renders results at
//   https://trackcourier.io/track-and-trace/{slug}/{number}
// after its JS solves a small proof-of-work challenge (NOT a captcha) and POSTs
// to /api/v1/get_checkpoints_table/.../{slug}/{number}, which returns clean
// JSON ({ Checkpoints: [...] }). We drive a headless page so the browser solves
// the challenge for us, then intercept that JSON response — far more robust than
// parsing the rendered HTML.
//
// Selected by CarrierService as the fallback when no paid aggregator key
// (TrackingMore / AfterShip) is configured. Returns null on any failure so the
// caller falls back to the saved timeline + the manual deep link.
const BASE = 'https://trackcourier.io';

// Our courier display name (lower-cased) → trackcourier.io slug. Slugs verified
// against the live courier list. Couriers not listed here have no slug, so the
// provider returns null and the UI offers the manual "track on courier site" link.
const SLUG_BY_NAME: Record<string, string> = {
  'st courier': 'st-courier',
  'st couriers': 'st-courier',
  dtdc: 'dtdc',
  'the professional couriers': 'professional-courier',
  'professional couriers': 'professional-courier',
  'professional courier': 'professional-courier',
  trackon: 'trackon-courier',
  'trackon couriers': 'trackon-courier',
  gati: 'gati-courier',
  'blue dart': 'blue-dart-courier',
  bluedart: 'blue-dart-courier',
  delhivery: 'delhivery-courier',
  'india post': 'india-post-domestic',
  'speed post': 'india-post-domestic',
};

// One raw checkpoint from the trackcourier.io JSON payload.
interface TcCheckpoint {
  Date?: string; // "05-Jun-2026"
  Time?: string; // "01:56 PM"
  Location?: string;
  Activity?: string; // free-text status, e.g. "Out for Delivery"
  CheckpointState?: string; // normalised tag, e.g. "delivered", "intransit"
}

// trackcourier.io's CheckpointState (+ the free-text Activity for nuance)
// → our DeliveryStatus.
function mapState(state?: string, activity?: string): DeliveryStatus {
  const s = (state ?? '').toLowerCase().replace(/[^a-z]/g, '');
  switch (s) {
    case 'delivered':
      return 'DELIVERED';
    case 'outfordelivery':
      return 'OUT_FOR_DELIVERY';
    case 'pickup':
    case 'pickedup':
      return 'DISPATCHED';
    case 'inforeceived':
    case 'pending':
    case 'notfound':
    case 'booked':
      return 'BOOKED';
    case 'exception':
    case 'expired':
      return /return|rto/i.test(activity ?? '') ? 'RETURNED' : 'IN_TRANSIT';
    case 'intransit':
    case 'transit':
      // Refine hub-arrival / dispatch from the activity wording.
      return mapStatusText(activity ?? 'in transit');
    default:
      return activity ? mapStatusText(activity) : 'IN_TRANSIT';
  }
}

export class TrackCourierProvider implements CarrierProvider {
  readonly name = 'trackcourier';
  private readonly logger = new Logger(TrackCourierProvider.name);

  // No API key required.
  isConfigured(): boolean {
    return true;
  }

  slugForCourierName(name?: string | null): string | undefined {
    if (!name) return undefined;
    return SLUG_BY_NAME[name.trim().toLowerCase()];
  }

  async fetchTracking(
    trackingNumber: string,
    opts?: { courierName?: string | null; slug?: string | null },
  ): Promise<CarrierTrackingResult | null> {
    const slug = opts?.slug || this.slugForCourierName(opts?.courierName);
    if (!slug) {
      this.logger.warn(
        `No trackcourier.io slug for courier "${opts?.courierName ?? ''}"`,
      );
      return null;
    }

    let raw: TcCheckpoint[] | null;
    try {
      raw = await this.scrape(slug, trackingNumber);
    } catch (e: any) {
      this.logger.warn(`trackcourier.io scrape failed: ${e?.message ?? e}`);
      return null;
    }
    if (!raw || raw.length === 0) return null;

    const checkpoints: NormalizedCheckpoint[] = raw
      .map((c): NormalizedCheckpoint | null => {
        const activity = decodeEntities(c.Activity ?? '');
        const occurredAt = parseDateTime(
          `${c.Date ?? ''} ${c.Time ?? ''}`.trim(),
        );
        if (!occurredAt) return null;
        const status = mapState(c.CheckpointState, activity);
        const location = decodeEntities(c.Location ?? '') || undefined;
        const externalId = createHash('sha1')
          .update(`${slug}|${c.Date}|${c.Time}|${activity}|${location ?? ''}`)
          .digest('hex');
        return { externalId, status, location, note: activity || undefined, occurredAt };
      })
      .filter((c): c is NormalizedCheckpoint => c !== null)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    if (checkpoints.length === 0) return null;

    const latest = checkpoints[checkpoints.length - 1];
    const delivered = checkpoints.some((c) => c.status === 'DELIVERED');
    const deliveredCp = checkpoints.filter((c) => c.status === 'DELIVERED').pop();

    return {
      slug,
      checkpoints,
      latestStatus: latest?.status ?? null,
      delivered,
      deliveredAt: delivered ? deliveredCp?.occurredAt : undefined,
    };
  }

  // Drive the results page so the browser solves the proof-of-work challenge,
  // then grab the JSON the page's own JS fetches.
  private scrape(slug: string, number: string): Promise<TcCheckpoint[] | null> {
    return withPage(async (page) => {
      const url = `${BASE}/track-and-trace/${slug}/${encodeURIComponent(number)}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      const resp = await page
        .waitForResponse(
          (r) =>
            /\/api\/v1\/get_checkpoints_table\//i.test(r.url()) &&
            r.request().method() === 'POST',
          { timeout: 25_000 },
        )
        .catch(() => null);
      if (!resp) return null;

      let json: any = null;
      try {
        json = await resp.json();
      } catch {
        try {
          json = JSON.parse(await resp.text());
        } catch {
          json = null;
        }
      }
      const list = json?.Checkpoints ?? json?.checkpoints ?? [];
      return Array.isArray(list) ? (list as TcCheckpoint[]) : [];
    });
  }
}

// trackcourier.io double-encodes some entities in the JSON (e.g. "&amp;").
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
