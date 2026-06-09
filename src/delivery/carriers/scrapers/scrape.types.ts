// ─── Web-scraping tracking types ─────────────────────────────────────────────
// These are the *raw* shapes a courier scraper produces, before the
// ScraperProvider normalises them into the app-wide NormalizedCheckpoint /
// CarrierTrackingResult shapes (see ../carrier.types.ts). Keeping scrapers in
// this looser shape lets each one stay focused on parsing its own site.

// One tracking checkpoint as scraped from a courier's website.
export interface ScrapedEvent {
  // Free-text status exactly as the courier words it (e.g. "Out for delivery",
  // "Reached destination hub", "Shipment booked"). Mapped to our DeliveryStatus
  // by mapStatusText() in scrape.util.ts.
  statusText: string;
  // Branch / city / hub where the scan happened, when present.
  location?: string;
  // When the scan occurred.
  occurredAt: Date;
  // A richer remark line to show beneath the status, when the site provides one
  // that differs from statusText.
  note?: string;
}

// The full result of scraping one tracking number.
export interface ScrapedTracking {
  // Courier slug that produced these events (e.g. "dtdc"). Persisted so later
  // syncs skip courier re-resolution — mirrors the API providers' `slug`.
  slug: string;
  events: ScrapedEvent[];
}

// One courier's scraper. Concrete implementations live in ./<courier>.scraper.ts
// and are registered in ./index.ts. Each MUST return null on any failure
// (network error, layout change, not-found, captcha) rather than throwing, so
// the provider can fall back cleanly to the saved timeline — exactly like the
// API providers do on a failed lookup.
export interface CourierScraper {
  // Canonical slug for this courier (stable; stored on the delivery record).
  readonly slug: string;
  // Lower-cased courier display names this scraper answers to. Used to resolve
  // a scraper from the user-entered "Courier Name".
  readonly aliases: string[];
  scrape(trackingNumber: string): Promise<ScrapedTracking | null>;
}
