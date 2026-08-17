// A party (customer or supplier) can hold several numbers: a mobile, an office
// landline, a residence line. Imported ERP exports routinely carry all three in
// separate columns (phone1 / phone2 / mobile / resi), and a good number of
// pharmacy customers have ONLY a landline.
//
// Storage shape: the full list lives in `phones` (Json), and the entry flagged
// primary is mirrored into the existing `phone` column. That mirror is the whole
// point — every read path in the app (list rows, invoice prints, search, ledger
// exports, the WhatsApp resolver) already reads `phone`, and none of them had to
// change. `phone` is therefore never written directly; it is derived from the
// list via `primaryOf`, so the two can't drift.
//
// The frontend keeps a mirror of this file at Medical-Frontend/src/lib/phones.ts.
// Changes to the label set or validation must land in both.

export type PhoneLabel = 'MOBILE' | 'LANDLINE' | 'OFFICE' | 'HOME' | 'OTHER';

export const PHONE_LABELS: PhoneLabel[] = ['MOBILE', 'LANDLINE', 'OFFICE', 'HOME', 'OTHER'];

export interface PartyPhone {
  /** As entered — separators preserved, because "0431-3501965" reads better than the raw digits. */
  number: string;
  label: PhoneLabel;
  isPrimary: boolean;
}

/** More than this is a paste accident, not a contact list. */
export const MAX_PARTY_PHONES = 8;

/** Digits only, with the +91 / 0091 / leading-0 trunk prefix stripped. */
export function phoneDigits(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(3);
  return digits;
}

/**
 * A WhatsApp-reachable number: a 10-digit Indian mobile. Landlines fail here,
 * which is what lets the forms say plainly that a landline-only party can't be
 * messaged instead of queuing a send that Meta will reject.
 */
export function isMobileNumber(raw: string | null | undefined): boolean {
  return /^[6-9]\d{9}$/.test(phoneDigits(raw));
}

/**
 * Any number we're willing to store. Deliberately loose: an Indian landline is
 * an STD code plus a subscriber number (9-12 digits together), and imported data
 * carries every separator style there is. Being strict here is what forced the
 * old "10 digits starting 6-9" rule to reject real customers.
 */
export function isValidPhone(raw: string | null | undefined): boolean {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 15) return false;
  return /^[+()\d\s-]+$/.test((raw ?? '').trim());
}

/** Human label for a number that has none — used when import can't tell us. */
export function inferLabel(raw: string | null | undefined): PhoneLabel {
  return isMobileNumber(raw) ? 'MOBILE' : 'LANDLINE';
}

/**
 * Clean an incoming list: drop blanks and invalid entries, collapse duplicates
 * (same digits, whatever the formatting), cap the count, and guarantee exactly
 * one primary. Preference for primary is an explicit flag, then the first
 * mobile, then simply the first entry — a landline-only party still gets one.
 */
export function normalizePartyPhones(input: unknown): PartyPhone[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const cleaned: PartyPhone[] = [];

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = (entry as PartyPhone).number;
    const number = typeof raw === 'string' ? raw.trim() : '';
    if (!number || !isValidPhone(number)) continue;

    const key = phoneDigits(number);
    if (seen.has(key)) continue;
    seen.add(key);

    const rawLabel = (entry as PartyPhone).label;
    cleaned.push({
      number,
      label: PHONE_LABELS.includes(rawLabel) ? rawLabel : inferLabel(number),
      isPrimary: (entry as PartyPhone).isPrimary === true,
    });
    if (cleaned.length >= MAX_PARTY_PHONES) break;
  }

  if (cleaned.length === 0) return [];

  let primaryIdx = cleaned.findIndex((p) => p.isPrimary);
  if (primaryIdx < 0) primaryIdx = cleaned.findIndex((p) => isMobileNumber(p.number));
  if (primaryIdx < 0) primaryIdx = 0;

  return cleaned.map((p, i) => ({ ...p, isPrimary: i === primaryIdx }));
}

/** The number that represents the party — what `phone` is kept equal to. */
export function primaryOf(phones: PartyPhone[]): string | null {
  return phones.find((p) => p.isPrimary)?.number ?? phones[0]?.number ?? null;
}

/** Numbers that could actually receive a WhatsApp message. */
export function whatsappCapable(phones: PartyPhone[]): PartyPhone[] {
  return phones.filter((p) => isMobileNumber(p.number));
}

/**
 * Build the list for a party that predates this feature (or for a create that
 * only supplied the flat fields), so a legacy `phone` + `alternatePhone` pair
 * turns into a proper two-entry list rather than silently losing the alternate.
 */
export function phonesFromLegacy(
  phone: string | null | undefined,
  alternatePhone?: string | null,
): PartyPhone[] {
  return normalizePartyPhones([
    { number: (phone ?? '').trim(), label: inferLabel(phone), isPrimary: true },
    { number: (alternatePhone ?? '').trim(), label: inferLabel(alternatePhone), isPrimary: false },
  ]);
}

/**
 * Resolve what a write should persist for `{ phones, phone }` together, so the
 * mirror can never be set by hand. `phones` absent (undefined) on a PATCH means
 * "not supplied" — the caller's existing values are left alone.
 */
export function resolvePhoneWrite(
  incomingPhones: unknown,
  fallbackPhone: string | null | undefined,
  fallbackAlternate?: string | null,
): { phones: PartyPhone[]; phone: string } | null {
  const list =
    incomingPhones === undefined
      ? phonesFromLegacy(fallbackPhone, fallbackAlternate)
      : normalizePartyPhones(incomingPhones);

  const resolved = list.length ? list : phonesFromLegacy(fallbackPhone, fallbackAlternate);
  const primary = primaryOf(resolved);
  if (!primary) return null;
  return { phones: resolved, phone: primary };
}
