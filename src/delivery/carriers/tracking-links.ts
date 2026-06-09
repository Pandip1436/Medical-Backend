// ─── Manual "track on courier website" deep links ────────────────────────────
// A universal fallback that works for EVERY courier, regardless of whether we
// can auto-scrape it: a link straight to the courier's own tracking page. Where
// the courier's URL scheme accepts the number as a query/path param we prefill
// it; otherwise we land the user on the tracking page to paste it. This is the
// only reliable option for couriers that gate tracking behind a CAPTCHA
// (The Professional Couriers, Gati) and a handy escape hatch when a scrape
// fails for any other reason.
const LINKS: { match: RegExp; url: (n: string) => string }[] = [
  { match: /st\s*couriers?/i, url: () => 'https://stcourier.com/track/shipment' },
  {
    match: /professional|tpc/i,
    url: () => 'https://www.tpcindia.com/',
  },
  {
    // Lands on DTDC's results page with the number prefilled — the user only
    // has to solve DTDC's captcha to see the status.
    match: /dtdc/i,
    url: (n) => `https://www.dtdc.com/track-your-shipment/?awb=${encodeURIComponent(n)}`,
  },
  {
    match: /trackon/i,
    url: (n) => `https://trackon.in/courier-tracking?awb=${encodeURIComponent(n)}`,
  },
  { match: /gati/i, url: () => 'https://www.gati.com/track-shipment/' },
  {
    match: /blue\s*dart/i,
    url: (n) =>
      `https://www.bluedart.com/tracking?trackFor=0&trackNo=${encodeURIComponent(n)}`,
  },
  {
    match: /delhivery/i,
    url: (n) => `https://www.delhivery.com/track/package/${encodeURIComponent(n)}`,
  },
  {
    match: /india\s*post|speed\s*post/i,
    url: () =>
      'https://www.indiapost.gov.in/_layouts/15/DOP.Portal.Tracking/TrackConsignment.aspx',
  },
];

// Resolve a "track it yourself" URL for the given courier + number. Returns
// undefined when the courier isn't one we have a link for.
export function trackingUrlFor(
  courierName?: string | null,
  trackingNumber?: string | null,
): string | undefined {
  if (!courierName) return undefined;
  const hit = LINKS.find((l) => l.match.test(courierName));
  return hit ? hit.url(trackingNumber ?? '') : undefined;
}
