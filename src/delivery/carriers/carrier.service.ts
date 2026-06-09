import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { CarrierProvider, CarrierTrackingResult } from './carrier.types';
import { TrackingMoreProvider } from './trackingmore.provider';
import { AftershipProvider } from './aftership.provider';
import { TrackCourierProvider } from './trackcourier.provider';
import { closeScraperBrowser } from './scrapers/scrape.util';
import { trackingUrlFor } from './tracking-links';

// Thin facade over the configured carrier provider. The provider is chosen at
// startup from env config (first key present wins):
//   TRACKINGMORE_API_KEY → TrackingMore live tracking (paid aggregator API)
//   AFTERSHIP_API_KEY    → AfterShip live tracking (paid aggregator API)
//   (none)               → TrackCourierProvider: zero-config web scraping via
//                          the public aggregator trackcourier.io, which tracks
//                          170+ couriers server-side — including the CAPTCHA-
//                          walled ones (DTDC, The Professional Couriers, Gati).
//                          When a scrape fails the app still falls back to the
//                          saved timeline + the manual "track on courier" link.
//
// Per-branch overrides (via the encrypted IntegrationCredential table) can be
// layered on later by resolving a key here before delegating — the rest of the
// app only depends on this service, not the concrete provider.
@Injectable()
export class CarrierService implements OnModuleDestroy {
  private readonly logger = new Logger(CarrierService.name);
  private readonly provider: CarrierProvider | null;

  constructor() {
    const trackingMoreKey = process.env.TRACKINGMORE_API_KEY?.trim();
    const aftershipKey = process.env.AFTERSHIP_API_KEY?.trim();
    if (trackingMoreKey) {
      this.provider = new TrackingMoreProvider(trackingMoreKey);
      this.logger.log('Carrier tracking enabled via TrackingMore');
    } else if (aftershipKey) {
      this.provider = new AftershipProvider(aftershipKey);
      this.logger.log('Carrier tracking enabled via AfterShip');
    } else {
      this.provider = new TrackCourierProvider();
      this.logger.log(
        'No carrier API key configured — using trackcourier.io web scraping',
      );
    }
  }

  // Release the shared scraping browser on shutdown (no-op for API providers).
  async onModuleDestroy(): Promise<void> {
    await closeScraperBrowser();
  }

  isConfigured(): boolean {
    return !!this.provider?.isConfigured();
  }

  // Name of the active provider (e.g. "trackingmore") for surfacing in the UI;
  // null when no provider is configured.
  providerName(): string | null {
    return this.provider?.name ?? null;
  }

  slugForCourierName(name?: string | null): string | undefined {
    return this.provider?.slugForCourierName(name);
  }

  // A "track it on the courier's own website" deep link — always available as a
  // manual fallback, independent of the active provider. Used by the UI when
  // live tracking can't run (e.g. a CAPTCHA-gated courier).
  trackingUrl(
    courierName?: string | null,
    trackingNumber?: string | null,
  ): string | undefined {
    return trackingUrlFor(courierName, trackingNumber);
  }

  // Whether the active provider can actually fetch this courier. The API
  // providers (TrackingMore/AfterShip) cover hundreds of couriers and can also
  // auto-detect from the number, so we assume yes. The web scraper
  // (trackcourier.io) can only track couriers it has a slug for — the rest
  // (e.g. "Other") are manual-link only.
  supportsCourier(name?: string | null): boolean {
    if (this.provider?.name === 'trackcourier') {
      return !!this.provider.slugForCourierName(name);
    }
    return !!this.provider?.isConfigured();
  }

  // Returns normalised tracking, or null when no provider is configured or the
  // lookup fails (caller falls back to the saved timeline).
  async fetchTracking(
    trackingNumber: string,
    opts?: { courierName?: string | null; slug?: string | null },
  ): Promise<CarrierTrackingResult | null> {
    if (!this.provider?.isConfigured()) return null;
    return this.provider.fetchTracking(trackingNumber, opts);
  }
}
