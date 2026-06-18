import { Prisma } from '@prisma/client';
import { NotificationType } from './dto/create-notification.dto';

// Any Prisma client works: the request-scoped transaction client (`tx`) passed
// from inside a `$transaction`, or the plain PrismaService for the rare
// non-transactional caller (e.g. approval rejection) — the full client is
// assignable to the narrower TransactionClient.
type Db = Prisma.TransactionClient;

// The marker every PAYMENT_DUE notification carries in its message. Keeping the
// convention here (and in generatePaymentDueAlerts) means there's one place that
// knows how to find the reminders for a given invoice.
export function invoiceMarker(invoiceId: string): string {
  return `[invoiceId:${invoiceId}]`;
}

// Canonical Payment-Due message. Shared by the scheduled generator and the
// refresh path below so the format (which the UI parses for the ₹ amount) lives
// in exactly one place.
export function buildPaymentDueMessage(
  customerName: string,
  outstanding: number,
  invoiceNumber: string,
  invoiceId: string,
): string {
  return `${customerName} has ₹${outstanding.toFixed(2)} outstanding · Invoice ${invoiceNumber}. ${invoiceMarker(invoiceId)}`;
}

export interface PaymentDueStateInput {
  outstanding: number;
  daysOutstanding: number;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  dueDate?: Date | string | null;
}

// The small JSON snapshot the table view reads for the "Aged" column and phone
// disambiguation. Mirrors PaymentDueState in notifications.service.ts.
export function buildPaymentDueState(input: PaymentDueStateInput) {
  return {
    kind: 'PAYMENT_DUE' as const,
    outstanding: input.outstanding,
    daysOutstanding: input.daysOutstanding,
    customerId: input.customerId ?? null,
    customerName: input.customerName ?? null,
    customerPhone: input.customerPhone ?? null,
    // The UI's "Due" column reads this. Always carry it so a refresh (e.g. on a
    // partial payment) never blanks the due date back to "—".
    dueDate: input.dueDate ?? null,
  };
}

export interface InvoiceLike {
  id: string;
  /** Invoice status AFTER the mutation that triggered this sync. */
  status: string;
  grandTotal: Prisma.Decimal | number;
  amountPaid: Prisma.Decimal | number;
  date?: Date | null;
  /** Needed only by the refresh branch (still-due invoices). */
  customerName?: string | null;
  invoiceNumber?: string | null;
  customerId?: string | null;
  customerPhone?: string | null;
  /** Credit-sale due date. If a caller doesn't include it, the refresh branch
   *  fetches it so the snapshot's `dueDate` is never blanked. */
  dueDate?: Date | null;
}

// Statuses that mean "nothing is owed anymore" — paid off, fully returned, or
// the invoice was cancelled outright.
const SETTLED = new Set(['PAID', 'RETURNED', 'CANCELLED']);

/**
 * Keep an invoice's PAYMENT_DUE reminders in sync with its current balance.
 *
 * - Balance cleared (PAID / RETURNED / CANCELLED, or outstanding ≈ 0)
 *     → resolve every open reminder for the invoice (resolvedAt + isRead),
 *       so it drops out of the Unread list and the badge count but stays in
 *       the All view as history. Idempotent: re-runs and "no reminder exists"
 *       are both no-ops.
 * - Still partly due
 *     → refresh the displayed amount so it never goes stale. Only rewrites when
 *       the customer name + invoice number are available to build the canonical
 *       message; otherwise it leaves the row for the 24h sweep to refresh.
 *
 * Designed to run inside the caller's existing transaction — pass the same `tx`.
 */
export async function syncPaymentDueForInvoice(
  db: Db,
  inv: InvoiceLike,
  userId?: string,
): Promise<void> {
  const base = {
    type: NotificationType.PAYMENT_DUE,
    message: { contains: invoiceMarker(inv.id) },
    resolvedAt: null,
  };
  const outstanding = Number(inv.grandTotal) - Number(inv.amountPaid);

  if (SETTLED.has(inv.status) || outstanding <= 0.01) {
    await db.notification.updateMany({
      where: base,
      data: { resolvedAt: new Date(), resolvedById: userId ?? null, isRead: true },
    });
    return;
  }

  // Partial payment / partial return — keep the reminder but refresh its amount.
  if (inv.customerName && inv.invoiceNumber) {
    const daysOutstanding = inv.date
      ? Math.floor((Date.now() - new Date(inv.date).getTime()) / 86_400_000)
      : 0;
    // Preserve the due date through the refresh. Most callers don't select it,
    // so fetch it when it's not supplied — otherwise the snapshot's dueDate
    // would be overwritten with null and the UI's "Due" column would show "—".
    const dueDate =
      inv.dueDate !== undefined
        ? inv.dueDate
        : (
            await db.invoice.findUnique({
              where: { id: inv.id },
              select: { dueDate: true },
            })
          )?.dueDate ?? null;
    await db.notification.updateMany({
      where: base,
      data: {
        message: buildPaymentDueMessage(
          inv.customerName,
          outstanding,
          inv.invoiceNumber,
          inv.id,
        ),
        entityState: buildPaymentDueState({
          outstanding,
          daysOutstanding,
          customerId: inv.customerId,
          customerName: inv.customerName,
          customerPhone: inv.customerPhone,
          dueDate,
        }) as any,
      },
    });
  }
}
