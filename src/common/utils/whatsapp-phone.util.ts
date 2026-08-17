import { normalizePartyPhones, whatsappCapable } from './party-phones.util';

// Resolve which number a WhatsApp message should go to.
//
// `whatsappNumber` is an OPTIONAL override of `phone`, used when a party's
// WhatsApp lives on a different line. Every caller used to write this as
// `whatsappNumber ?? phone`, which is wrong for the value the customer form
// actually submits when the override field is left empty: `""`. `??` falls back
// only on null/undefined, so a blank override won the coalesce and produced an
// empty recipient — the send was then rejected as "customer has no phone",
// pointing at a customer whose phone was sitting right there on screen.
//
// Blank, whitespace, and null all mean "no override" — hence `||` on trimmed
// values, and one shared helper so the five call sites can't drift again.
// Since parties can hold several numbers, `phone` is no longer guaranteed to be
// a mobile: a customer whose only contact is an office landline has that landline
// as their primary, and it is what shows under their name. Sending there would be
// rejected by Meta, so the order is: explicit override → first WhatsApp-capable
// number in the list → `phone`. The last step keeps behaviour identical for the
// parties that have a single mobile, which is nearly all of them.
export function resolveWhatsAppPhone(party: {
  whatsappNumber?: string | null;
  phone?: string | null;
  phones?: unknown;
}): string | null {
  const override = party.whatsappNumber?.trim();
  if (override) return override;

  const capable = whatsappCapable(normalizePartyPhones(party.phones));
  if (capable.length) return capable[0].number;

  return party.phone?.trim() || null;
}

// Normalise an optional override for STORAGE: blank becomes null, so the column
// holds "no override" rather than an empty string. Keeps the data clean at the
// source; resolveWhatsAppPhone stays tolerant of rows written before this.
//
// `undefined` passes through untouched — for a PATCH that means "field not
// supplied", which must stay distinct from "cleared".
export function normalizeWhatsAppNumber(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value?.trim() || null;
}
