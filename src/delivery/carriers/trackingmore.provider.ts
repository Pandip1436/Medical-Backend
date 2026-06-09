import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DeliveryStatus } from '@prisma/client';
import {
  CarrierProvider,
  CarrierTrackingResult,
  NormalizedCheckpoint,
} from './carrier.types';

// TrackingMore v4 tracking API. One API key (header `Tracking-Api-Key`) covers
// 1,000+ couriers. Docs: https://www.trackingmore.com/docs/trackingmore/
//   POST /v4/trackings/create   → register a tracking (4016 = already exists)
//   GET  /v4/trackings/get      → fetch results (origin_info.trackinfo[])
//   POST /v4/couriers/detect    → guess the courier_code from a number
const API_BASE = 'https://api.trackingmore.com/v4';

// Display courier name → TrackingMore courier_code. Falls back to
// /couriers/detect when a name isn't mapped or no name is set.
const CODE_BY_NAME: Record<string, string> = {
  'st courier': 'st-courier',
  'the professional couriers': 'professional-couriers',
  'professional couriers': 'professional-couriers',
  dtdc: 'dtdc',
  'blue dart': 'bluedart',
  bluedart: 'bluedart',
  delhivery: 'delhivery',
  'india post': 'india-post',
  'speed post': 'india-post',
  trackon: 'trackon',
  gati: 'gati',
};

// TrackingMore delivery_status / checkpoint_delivery_status (+ substatus and
// the free-text detail) → our DeliveryStatus.
function mapStatus(status?: string, substatus?: string, detail?: string): DeliveryStatus {
  const s = (status ?? '').toLowerCase();
  const sub = (substatus ?? '').toLowerCase();
  const d = (detail ?? '').toLowerCase();
  switch (s) {
    case 'inforeceived':
    case 'pending':
    case 'notfound':
      return 'BOOKED';
    case 'pickup':
      return 'DISPATCHED';
    case 'transit':
      if (/hub|facility|sorting|received at|reached|arrived/.test(d) || sub.includes('transit_003')) {
        return 'ARRIVED_AT_HUB';
      }
      if (/picked up|dispatch|departed|shipped/.test(d)) return 'DISPATCHED';
      return 'IN_TRANSIT';
    case 'outfordelivery':
      return 'OUT_FOR_DELIVERY';
    case 'delivered':
      return 'DELIVERED';
    case 'undelivered':
      return 'OUT_FOR_DELIVERY';
    case 'exception':
      if (/return/.test(d) || sub.includes('exception_004') || sub.includes('return')) return 'RETURNED';
      return 'IN_TRANSIT';
    case 'expired':
      return 'IN_TRANSIT';
    default:
      return 'IN_TRANSIT';
  }
}

export class TrackingMoreProvider implements CarrierProvider {
  readonly name = 'trackingmore';
  private readonly logger = new Logger(TrackingMoreProvider.name);

  constructor(private readonly apiKey: string) {}

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  slugForCourierName(name?: string | null): string | undefined {
    if (!name) return undefined;
    return CODE_BY_NAME[name.trim().toLowerCase()];
  }

  private headers() {
    return {
      'Tracking-Api-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  // Ask TrackingMore to guess the courier from the tracking number alone.
  private async detectCode(trackingNumber: string): Promise<string | undefined> {
    try {
      const resp = await fetch(`${API_BASE}/couriers/detect`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ tracking_number: trackingNumber }),
      });
      const json: any = await resp.json().catch(() => ({}));
      return json?.data?.[0]?.courier_code;
    } catch (e: any) {
      this.logger.warn(`courier detect failed: ${e?.message ?? e}`);
      return undefined;
    }
  }

  // Register the tracking so TrackingMore starts polling the carrier. Treats
  // "already exists" (4016) as success.
  private async ensureTracking(code: string, trackingNumber: string): Promise<void> {
    try {
      const resp = await fetch(`${API_BASE}/trackings/create`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ tracking_number: trackingNumber, courier_code: code }),
      });
      if (!resp.ok) {
        const json: any = await resp.json().catch(() => ({}));
        const respCode = json?.meta?.code;
        // 4016 = tracking already exists → fine.
        if (respCode !== 4016) {
          this.logger.warn(
            `create tracking ${code}/${trackingNumber} → ${resp.status} ${JSON.stringify(json?.meta ?? {})}`,
          );
        }
      }
    } catch (e: any) {
      this.logger.warn(`create tracking failed: ${e?.message ?? e}`);
    }
  }

  async fetchTracking(
    trackingNumber: string,
    opts?: { courierName?: string | null; slug?: string | null },
  ): Promise<CarrierTrackingResult | null> {
    if (!this.isConfigured()) return null;

    const code =
      opts?.slug ||
      this.slugForCourierName(opts?.courierName) ||
      (await this.detectCode(trackingNumber));
    if (!code) {
      this.logger.warn(`could not resolve courier_code for ${trackingNumber}`);
      return null;
    }

    await this.ensureTracking(code, trackingNumber);

    let json: any;
    try {
      const url =
        `${API_BASE}/trackings/get?tracking_numbers=${encodeURIComponent(trackingNumber)}` +
        `&courier_code=${encodeURIComponent(code)}`;
      const resp = await fetch(url, { headers: this.headers() });
      json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        this.logger.warn(`get tracking → ${resp.status} ${JSON.stringify(json?.meta ?? {})}`);
        return null;
      }
    } catch (e: any) {
      this.logger.warn(`get tracking failed: ${e?.message ?? e}`);
      return null;
    }

    // /trackings/get returns data as an array of tracking objects.
    const tracking = Array.isArray(json?.data) ? json.data[0] : json?.data;
    if (!tracking) return null;

    const rawCheckpoints: any[] = Array.isArray(tracking?.origin_info?.trackinfo)
      ? tracking.origin_info.trackinfo
      : [];

    const checkpoints: NormalizedCheckpoint[] = rawCheckpoints
      .filter((c) => c?.checkpoint_date)
      .map((c) => {
        const status = mapStatus(
          c.checkpoint_delivery_status,
          c.checkpoint_delivery_substatus,
          c.tracking_detail,
        );
        const externalId = createHash('sha1')
          .update(`${code}|${c.checkpoint_date}|${c.checkpoint_delivery_status ?? ''}|${c.tracking_detail ?? ''}`)
          .digest('hex');
        return {
          externalId,
          status,
          location: c.location || undefined,
          note: c.tracking_detail || undefined,
          occurredAt: new Date(c.checkpoint_date),
        };
      })
      // TrackingMore returns newest-first; normalise to chronological order so
      // the timeline + "latest" derivation are stable.
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    // Headline status comes from the tracking-level delivery_status, falling
    // back to the most recent checkpoint.
    const latestStatus = tracking.delivery_status
      ? mapStatus(tracking.delivery_status)
      : checkpoints.length > 0
        ? checkpoints[checkpoints.length - 1].status
        : null;

    const delivered = (tracking.delivery_status ?? '').toLowerCase() === 'delivered';
    // The actual delivery time is the last DELIVERED checkpoint's timestamp,
    // not when we polled.
    const deliveredCp = checkpoints.filter((c) => c.status === 'DELIVERED').pop();

    return {
      slug: code,
      checkpoints,
      latestStatus,
      delivered,
      deliveredAt: delivered ? deliveredCp?.occurredAt : undefined,
    };
  }
}
