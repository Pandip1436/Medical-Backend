import { DeliveryStatus } from '@prisma/client';

// A carrier checkpoint normalised into our own shape so the rest of the app
// never sees provider-specific payloads.
export interface NormalizedCheckpoint {
  // Stable per-checkpoint hash → lets repeated syncs skip already-imported
  // checkpoints (stored in DeliveryEvent.externalId).
  externalId: string;
  status: DeliveryStatus;
  location?: string;
  note?: string;
  occurredAt: Date;
}

export interface CarrierTrackingResult {
  // The resolved courier slug (e.g. "dtdc") — persisted so later syncs skip
  // re-detection.
  slug: string;
  checkpoints: NormalizedCheckpoint[];
  // Latest carrier status (from the most recent checkpoint / top-level tag).
  latestStatus: DeliveryStatus | null;
  delivered: boolean;
  // Actual delivery timestamp (the DELIVERED checkpoint's time), when delivered.
  deliveredAt?: Date;
}

// A pluggable tracking provider. Today only AfterShip is implemented; swapping
// in Shiprocket / a direct carrier API means adding another class behind this
// interface — DeliveryService never changes.
export interface CarrierProvider {
  readonly name: string;
  isConfigured(): boolean;
  // Best-effort map from our display courier name to the provider's slug.
  slugForCourierName(name?: string | null): string | undefined;
  fetchTracking(
    trackingNumber: string,
    opts?: { courierName?: string | null; slug?: string | null },
  ): Promise<CarrierTrackingResult | null>;
}
