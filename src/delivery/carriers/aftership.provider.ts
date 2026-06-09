import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DeliveryStatus } from '@prisma/client';
import {
  CarrierProvider,
  CarrierTrackingResult,
  NormalizedCheckpoint,
} from './carrier.types';

// AfterShip v4 tracking API. One API key (header `aftership-api-key`) covers
// 1,100+ couriers. Docs: https://www.aftership.com/docs/tracking/quickstart
//   POST /v4/trackings              → register a tracking (idempotent-ish)
//   GET  /v4/trackings/{slug}/{num} → fetch checkpoints
//   POST /v4/couriers/detect        → guess the courier slug from a number
const API_BASE = 'https://api.aftership.com/v4';

// Display courier name → AfterShip slug. Falls back to /couriers/detect when a
// name isn't mapped or no name is set.
const SLUG_BY_NAME: Record<string, string> = {
  'st courier': 'st-courier',
  'the professional couriers': 'the-professional-couriers',
  'professional couriers': 'the-professional-couriers',
  dtdc: 'dtdc',
  'blue dart': 'bluedart',
  bluedart: 'bluedart',
  delhivery: 'delhivery',
  'india post': 'india-post',
  'speed post': 'india-post',
  trackon: 'trackon-couriers',
  gati: 'gati-kwe',
};

// AfterShip `tag` / `subtag` → our DeliveryStatus. Checkpoint messages are used
// as a light tie-breaker for hub arrivals and dispatch.
function mapCheckpoint(tag?: string, subtag?: string, message?: string): DeliveryStatus {
  const m = (message ?? '').toLowerCase();
  const st = (subtag ?? '').toLowerCase();
  switch (tag) {
    case 'InfoReceived':
    case 'Pending':
      return 'BOOKED';
    case 'InTransit':
      if (/hub|facility|sorting|received at|reached/.test(m) || st.includes('intransit_003')) {
        return 'ARRIVED_AT_HUB';
      }
      if (/picked up|dispatch|departed|shipped/.test(m)) return 'DISPATCHED';
      return 'IN_TRANSIT';
    case 'OutForDelivery':
    case 'AttemptFail':
      return 'OUT_FOR_DELIVERY';
    case 'AvailableForPickup':
      return 'ARRIVED_AT_HUB';
    case 'Delivered':
      return 'DELIVERED';
    case 'Exception':
      // Returns surface as an Exception subtag/message in AfterShip.
      if (/return/.test(m) || st.includes('exception_010')) return 'RETURNED';
      return 'IN_TRANSIT';
    case 'Expired':
      return 'IN_TRANSIT';
    default:
      return 'IN_TRANSIT';
  }
}

export class AftershipProvider implements CarrierProvider {
  readonly name = 'aftership';
  private readonly logger = new Logger(AftershipProvider.name);

  constructor(private readonly apiKey: string) {}

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  slugForCourierName(name?: string | null): string | undefined {
    if (!name) return undefined;
    return SLUG_BY_NAME[name.trim().toLowerCase()];
  }

  private headers() {
    return {
      'aftership-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  // Ask AfterShip to guess the courier from the tracking number alone.
  private async detectSlug(trackingNumber: string): Promise<string | undefined> {
    try {
      const resp = await fetch(`${API_BASE}/couriers/detect`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ tracking: { tracking_number: trackingNumber } }),
      });
      const json: any = await resp.json().catch(() => ({}));
      return json?.data?.couriers?.[0]?.slug;
    } catch (e: any) {
      this.logger.warn(`courier detect failed: ${e?.message ?? e}`);
      return undefined;
    }
  }

  // Register the tracking so AfterShip starts polling the carrier. Treats
  // "already exists" (4003) as success.
  private async ensureTracking(slug: string, trackingNumber: string): Promise<void> {
    try {
      const resp = await fetch(`${API_BASE}/trackings`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ tracking: { slug, tracking_number: trackingNumber } }),
      });
      if (!resp.ok) {
        const json: any = await resp.json().catch(() => ({}));
        const code = json?.meta?.code;
        // 4003 = tracking already exists → fine.
        if (code !== 4003) {
          this.logger.warn(`create tracking ${slug}/${trackingNumber} → ${resp.status} ${JSON.stringify(json?.meta ?? {})}`);
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

    const slug =
      opts?.slug ||
      this.slugForCourierName(opts?.courierName) ||
      (await this.detectSlug(trackingNumber));
    if (!slug) {
      this.logger.warn(`could not resolve courier slug for ${trackingNumber}`);
      return null;
    }

    await this.ensureTracking(slug, trackingNumber);

    let json: any;
    try {
      const resp = await fetch(
        `${API_BASE}/trackings/${encodeURIComponent(slug)}/${encodeURIComponent(trackingNumber)}`,
        { headers: this.headers() },
      );
      json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        this.logger.warn(`get tracking → ${resp.status} ${JSON.stringify(json?.meta ?? {})}`);
        return null;
      }
    } catch (e: any) {
      this.logger.warn(`get tracking failed: ${e?.message ?? e}`);
      return null;
    }

    const tracking = json?.data?.tracking;
    if (!tracking) return null;

    const rawCheckpoints: any[] = Array.isArray(tracking.checkpoints) ? tracking.checkpoints : [];
    const checkpoints: NormalizedCheckpoint[] = rawCheckpoints
      .filter((c) => c?.checkpoint_time)
      .map((c) => {
        const status = mapCheckpoint(c.tag, c.subtag, c.message);
        const location =
          c.location ||
          [c.city, c.state, c.country_name].filter(Boolean).join(', ') ||
          undefined;
        const note = c.message || c.subtag_message || undefined;
        const externalId = createHash('sha1')
          .update(`${slug}|${c.checkpoint_time}|${c.tag ?? ''}|${c.message ?? ''}`)
          .digest('hex');
        return {
          externalId,
          status,
          location,
          note,
          occurredAt: new Date(c.checkpoint_time),
        };
      });

    const latestStatus =
      checkpoints.length > 0
        ? checkpoints[checkpoints.length - 1].status
        : tracking.tag
          ? mapCheckpoint(tracking.tag)
          : null;

    const delivered = tracking.tag === 'Delivered';
    const deliveredCp = checkpoints.filter((c) => c.status === 'DELIVERED').pop();

    return {
      slug,
      checkpoints,
      latestStatus,
      delivered,
      deliveredAt: delivered ? deliveredCp?.occurredAt : undefined,
    };
  }
}
