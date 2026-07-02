import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto, NotificationType } from './dto/create-notification.dto';
import {
  NOTIFICATION_CREATED,
  type NotificationCreatedPayload,
  type NotificationKind,
} from '../events/notification-events';
import { buildPaymentDueMessage, buildPaymentDueState } from './payment-due-sync';

// Window-based dedup: don't fire the same alert again within this many hours
// when there's no stronger signal (user hasn't read/resolved/snoozed).
const DEDUP_WINDOW_HOURS = Number(process.env.NOTIFICATION_DEDUP_WINDOW_HOURS ?? 24);
// Once a notification is explicitly resolved by the user, suppress re-firing
// for this long — the user has acknowledged it, we don't need to keep nagging.
const RESOLVED_SUPPRESS_DAYS = Number(process.env.NOTIFICATION_RESOLVED_DAYS ?? 30);
// Marking as read (without resolving) is a softer signal: suppress for a few days.
const READ_SUPPRESS_DAYS = Number(process.env.NOTIFICATION_READ_DAYS ?? 3);

function dedupSince(): Date {
  const d = new Date();
  d.setHours(d.getHours() - DEDUP_WINDOW_HOURS);
  return d;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// Returns the OR clauses that, if matched by an existing notification,
// mean "don't fire a new one." Layered signals so user actions take effect:
//   - active alert (unread, unresolved, unsnoozed)  → forever, until acted on
//   - snoozed for the future                        → until snooze expires
//   - resolved within RESOLVED_SUPPRESS_DAYS        → ~30 days quiet
//   - read within READ_SUPPRESS_DAYS                → ~3 days quiet
//   - fallback: any record within DEDUP_WINDOW_HOURS → 24h baseline
function suppressionClauses(): any[] {
  const now = new Date();
  return [
    { isRead: false, resolvedAt: null, snoozedUntil: null },
    { isRead: false, resolvedAt: null, snoozedUntil: { gt: now } },
    { resolvedAt: { gte: daysAgo(RESOLVED_SUPPRESS_DAYS) } },
    { isRead: true, resolvedAt: null, createdAt: { gte: daysAgo(READ_SUPPRESS_DAYS) } },
    { createdAt: { gte: dedupSince() } },
  ];
}

// ─── Layer 2: state-change escalation ──────────────────────────────
// When suppression would skip a new alert, override and fire anyway if the
// underlying situation has worsened since the last alert. e.g. stock dropped
// from 5 → 1 — the user already acknowledged "5 left", but "1 left" deserves
// a fresh poke. State shapes are intentionally small JSON blobs.
type LowStockState   = { kind: 'LOW_STOCK';   totalStock: number; minStock: number };
type ExpiryState     = { kind: 'EXPIRY';      daysLeft: number };
type PaymentDueState = {
  kind: 'PAYMENT_DUE';
  outstanding: number;
  daysOutstanding: number;
  // Customer identity carried so the UI can show + disambiguate by phone
  // (two customers can share a name) without a second lookup.
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
};

// How much worse the situation must be to override suppression
const LOW_STOCK_DROP_PCT = 0.25;    // stock dropped 25%+ from last snapshot

// Payment-due reminders: nudge once a day for up to this many days, then stop.
// A one-time Resolve (or the invoice being paid) ends them early — see
// generatePaymentDueAlerts.
const PAYMENT_DUE_MAX_REMINDERS = Number(process.env.PAYMENT_DUE_MAX_REMINDERS ?? 3);

// Customer dues start alerting only this many days BEFORE the invoice's due
// date (a pre-due reminder). Invoices with no due date alert immediately.
const CUSTOMER_PAYMENT_DUE_BEFORE_DAYS = Number(process.env.CUSTOMER_PAYMENT_DUE_BEFORE_DAYS ?? 3);

// Supplier dues only start alerting once the GRN is this many days past its
// supplier-invoice date (the agreed payment term). Set to 0 to alert immediately.
const SUPPLIER_PAYMENT_DUE_AFTER_DAYS = Number(process.env.SUPPLIER_PAYMENT_DUE_AFTER_DAYS ?? 60);

function shouldEscalateLowStock(prev: LowStockState | null, next: LowStockState): boolean {
  // Legacy rows (entityState null — created before this field existed) used
  // to fall through and force a refresh. That caused visible duplicates: the
  // old null-state row stayed (active-alert suppression preserved it), and
  // a brand-new row got stamped alongside it. We now treat null prev as
  // "no change to escalate from" — the suppression clauses already keep us
  // from spamming, and the legacy row will be cleaned up out-of-band.
  if (!prev) return false;
  // Was above min, now below — definitely re-alert (the situation regressed).
  if (prev.totalStock > prev.minStock && next.totalStock <= next.minStock) return true;
  // Stock dropped meaningfully.
  if (next.totalStock < prev.totalStock * (1 - LOW_STOCK_DROP_PCT)) return true;
  return false;
}
// Expiry: the batch's expiry date is fixed; once acknowledged, never re-fire
// for the same batch (the suppression window naturally covers it).
function shouldEscalateExpiry(_prev: ExpiryState | null, _next: ExpiryState): boolean {
  return false;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  // Centralised create+emit so every notification creation path (manual,
  // low-stock, expiry, reminder, payment-due) consistently fires the
  // NOTIFICATION_CREATED event for downstream channel listeners (WhatsApp,
  // email, push). Listeners filter on `type` and re-fetch their own context
  // from `entityId` — the payload itself stays minimal so it's stable as
  // schemas evolve.
  private async createAndEmit(
    data: Parameters<PrismaService['notification']['create']>[0]['data'],
    entityId: string | null,
  ) {
    const row = await this.prisma.notification.create({ data });
    const payload: NotificationCreatedPayload = {
      notificationId: row.id,
      type: row.type as NotificationKind,
      entityId,
      branchId: row.branchId ?? null,
    };
    this.events.emit(NOTIFICATION_CREATED, payload);
    return row;
  }

  async create(dto: CreateNotificationDto) {
    return this.prisma.notification.create({ data: dto });
  }

  // Filters:
  //   branchId    — scope to a branch (also includes null-branch global rows)
  //   onlyUnread  — drop isRead=true
  //   type        — filter to a single NotificationType
  //   reminders   — 'only' = SYSTEM rows with [reminderId:] marker (the
  //                 Reminder folder); 'exclude' = everything else
  //                 (the System folder, which is SYSTEM minus reminders).
  //
  // Pagination contract:
  //   When BOTH `skip` and `take` are provided, returns the envelope
  //   `{ data, total, hasMore }` and clamps `take` to 100. Otherwise returns
  //   a raw array capped at 1000 — preserves backward compat for the
  //   existing store fetch + 60s poller that don't know about pagination.
  async findAll(opts: {
    branchId?: string;
    onlyUnread?: boolean;
    /** Mirror of onlyUnread for the opposite filter — only ALREADY-read rows. */
    onlyRead?: boolean;
    type?: NotificationType;
    reminders?: 'only' | 'exclude';
    /** Filter by resolution state. 'only' = resolved rows; 'exclude' = unresolved. */
    resolved?: 'only' | 'exclude';
    /** Free-text search across title + message (case-insensitive contains). */
    q?: string;
    /** Row ordering. Defaults to newest-first. */
    sort?: 'newest' | 'oldest' | 'unread';
    skip?: number;
    take?: number;
  } = {}) {
    const now = new Date();
    // Each AND clause must be satisfied. Using an explicit array avoids the
    // top-level-OR-overrides-everything pitfall when mixing OR + branch + read filters.
    const and: any[] = [
      // Hide actively-snoozed; ones whose snooze window has elapsed come back automatically.
      { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
    ];
    if (opts.branchId) {
      and.push({ OR: [{ branchId: opts.branchId }, { branchId: null }] });
    }
    if (opts.onlyUnread) and.push({ isRead: false });
    if (opts.onlyRead) and.push({ isRead: true });
    if (opts.type) and.push({ type: opts.type });
    // Reminders are SYSTEM rows tagged with `[reminderId:…]`. The "Reminder"
    // folder wants just those; the "System" folder wants SYSTEM rows that are
    // NOT reminders. Apply on top of any `type` filter.
    if (opts.reminders === 'only') {
      and.push({ type: NotificationType.SYSTEM, message: { contains: '[reminderId:' } });
    } else if (opts.reminders === 'exclude') {
      and.push({ NOT: { message: { contains: '[reminderId:' } } });
    }
    // Resolution state — the "Resolved" folder toggle shows alerts the system or
    // a user has closed out (resolvedAt set); 'exclude' keeps only still-open ones.
    if (opts.resolved === 'only') {
      and.push({ resolvedAt: { not: null } });
    } else if (opts.resolved === 'exclude') {
      and.push({ resolvedAt: null });
    }
    if (opts.q && opts.q.trim()) {
      const q = opts.q.trim();
      and.push({
        OR: [
          { title:   { contains: q, mode: 'insensitive' } },
          { message: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    // Newest-first by default. "oldest" reverses; "unread" floats unread rows
    // to the top, then newest-first within each read-state group.
    const orderBy =
      opts.sort === 'oldest'
        ? { createdAt: 'asc' as const }
        : opts.sort === 'unread'
          ? [{ isRead: 'asc' as const }, { createdAt: 'desc' as const }]
          : { createdAt: 'desc' as const };

    const paginated =
      typeof opts.skip === 'number' && typeof opts.take === 'number';
    if (paginated) {
      const skip = Math.max(0, opts.skip!);
      const take = Math.min(Math.max(1, opts.take!), 100);
      const [data, total] = await Promise.all([
        this.prisma.notification.findMany({
          where: { AND: and },
          orderBy,
          skip,
          take,
        }),
        this.prisma.notification.count({ where: { AND: and } }),
      ]);
      return { data, total, hasMore: skip + data.length < total };
    }

    return this.prisma.notification.findMany({
      where: { AND: and },
      orderBy,
      take: 1000,
    });
  }

  async markAsRead(id: string) {
    return this.prisma.notification.update({ where: { id }, data: { isRead: true } });
  }

  async markAllAsRead(branchId?: string) {
    return this.prisma.notification.updateMany({
      where: { isRead: false, ...(branchId ? { branchId } : {}) },
      data: { isRead: true },
    });
  }

  async markManyAsRead(ids: string[]) {
    if (!ids.length) return { count: 0 };
    return this.prisma.notification.updateMany({
      where: { id: { in: ids } },
      data: { isRead: true },
    });
  }

  async snooze(id: string, until: Date) {
    return this.prisma.notification.update({
      where: { id },
      data: { snoozedUntil: until },
    });
  }

  // Marks the notification as resolved (action taken). Independent of isRead.
  async resolve(id: string, userId?: string) {
    const row = await this.prisma.notification.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedById: userId ?? null, isRead: true },
    });
    // Payment-due reminders fire daily for the same entity. Resolving one
    // resolves the whole run — a single "done" stops every reminder for that
    // invoice / GRN (and the generator never re-creates them once resolved).
    const dueSibling: { type: NotificationType; marker: RegExp } | null =
      row.type === NotificationType.PAYMENT_DUE
        ? { type: NotificationType.PAYMENT_DUE, marker: /\[invoiceId:([^\]]+)\]/ }
        : row.type === NotificationType.SUPPLIER_PAYMENT_DUE
          ? { type: NotificationType.SUPPLIER_PAYMENT_DUE, marker: /\[grnId:([^\]]+)\]/ }
          : null;
    if (dueSibling) {
      const m = (row.message ?? '').match(dueSibling.marker);
      if (m) {
        await this.prisma.notification.updateMany({
          where: {
            type: dueSibling.type,
            message: { contains: m[0] },
            resolvedAt: null,
          },
          data: { resolvedAt: new Date(), resolvedById: userId ?? null, isRead: true },
        });
      }
    }
    return row;
  }

  async remove(id: string) {
    return this.prisma.notification.delete({ where: { id } });
  }

  async removeMany(ids: string[]) {
    if (!ids.length) return { count: 0 };
    return this.prisma.notification.deleteMany({
      where: { id: { in: ids } },
    });
  }

  async clearAll(branchId?: string) {
    return this.prisma.notification.deleteMany({
      where: branchId ? { branchId } : {},
    });
  }

  // ── Auto-generate alerts ──────────────────────────────────────────────────

  async generateLowStockAlerts(branchId?: string) {
    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        // Include products for this branch AND products with no branch assigned
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      },
      select: {
        id: true, name: true, totalStock: true, minStock: true, branchId: true,
        // Used to suppress alerts for placeholder products that have never
        // been stocked — see filter below.
        _count: { select: { batches: true } },
      },
    });

    const lowStock = products.filter((p) => {
      // Skip catalog placeholders: a product with zero batches ever created
      // has never been stocked, so "low stock" is meaningless noise. Once it
      // receives its first GRN a batch record is created and it becomes
      // eligible for alerts.
      if (p._count.batches === 0) return false;
      if (p.totalStock <= 0) return true;
      if (p.minStock > 0 && p.totalStock <= p.minStock) return true;
      return false;
    });

    let created = 0;

    for (const p of lowStock) {
      // Layered suppression — see suppressionClauses() for the full ruleset.
      const existing = await this.prisma.notification.findFirst({
        where: {
          type: NotificationType.LOW_STOCK,
          message: { contains: `[productId:${p.id}]` },
          OR: suppressionClauses(),
        },
        orderBy: { createdAt: 'desc' },
      });
      const nextState: LowStockState = {
        kind: 'LOW_STOCK',
        totalStock: p.totalStock,
        minStock: p.minStock,
      };
      // Suppressed AND state hasn't worsened — quietly skip.
      if (existing && !shouldEscalateLowStock(existing.entityState as LowStockState | null, nextState)) {
        continue;
      }
      const stockLabel = p.totalStock <= 0
        ? 'is out of stock'
        : `has only ${p.totalStock} units left (min: ${p.minStock})`;
      await this.createAndEmit(
        {
          type: NotificationType.LOW_STOCK,
          title: 'Low Stock Alert',
          message: `${p.name} ${stockLabel}. [productId:${p.id}]`,
          actionUrl: `/inventory/product-history?productId=${p.id}`,  // already acts as product detail
          branchId: p.branchId ?? branchId ?? null,  // tag with active branch if product has none
          entityState: nextState as any,
        },
        p.id,
      );
      created++;
    }
    return { created };
  }

  async generateExpiryAlerts(branchId?: string, daysAhead = 90) {
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);

    // Lower bound = today so we don't include batches expired long ago on every run.
    // We keep already-expired ones by using a far-past lower bound (30 days grace window).
    const gracePast = new Date();
    gracePast.setDate(gracePast.getDate() - 30);

    const batches = await this.prisma.batch.findMany({
      where: {
        quantity: { gt: 0 },
        expiryDate: {
          gte: gracePast,  // don't alert on stock expired >30 days ago (likely written off)
          lte: cutoff,     // within the look-ahead window
        },
        product: {
          isActive: true,
          ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
        },
      },
      include: {
        product: {
          select: { name: true, branchId: true },
        },
      },
    });

    let created = 0;
    for (const b of batches) {
      // Layered suppression — see suppressionClauses().
      const existing = await this.prisma.notification.findFirst({
        where: {
          type: NotificationType.EXPIRY,
          message: { contains: `[batchId:${b.id}]` },
          OR: suppressionClauses(),
        },
        orderBy: { createdAt: 'desc' },
      });
      const daysLeft = Math.ceil((new Date(b.expiryDate).getTime() - now.getTime()) / 86400000);
      const nextState: ExpiryState = { kind: 'EXPIRY', daysLeft };
      // Expiry never escalates — a batch's expiry date is fixed. So if a
      // suppression record exists, always skip.
      if (existing && !shouldEscalateExpiry(existing.entityState as ExpiryState | null, nextState)) {
        continue;
      }
      const label = daysLeft <= 0 ? 'has already expired' : `expires in ${daysLeft} day(s)`;
      await this.createAndEmit(
        {
          type: NotificationType.EXPIRY,
          title: daysLeft <= 0 ? 'Expired Stock' : 'Expiry Alert',
          message: `${b.product.name} · Batch ${b.batchNumber} ${label}. [batchId:${b.id}]`,
          actionUrl: `/inventory/batches/detail?id=${b.id}`,
          branchId: b.product.branchId ?? branchId ?? null,
          entityState: nextState as any,
        },
        b.id,
      );
      created++;
    }

    // Reconcile: expiry has no per-sale sync like payment-due, so a batch that
    // sold out (qty → 0) or was deleted leaves its alert stuck in the Unread
    // list forever. Resolve those here on the sweep so the list stays truthful.
    const resolved = await this.resolveStaleExpiryAlerts(branchId);
    return { created, resolved };
  }

  // Resolve active EXPIRY alerts whose batch no longer has stock (qty 0) or was
  // deleted — they're no longer actionable. Resolved (not deleted) so they stay
  // in the All/Resolved history.
  private async resolveStaleExpiryAlerts(branchId?: string): Promise<number> {
    const active = await this.prisma.notification.findMany({
      where: {
        type: NotificationType.EXPIRY,
        resolvedAt: null,
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      },
      select: { id: true, message: true },
    });

    // Map each alert to the batchId in its [batchId:…] marker.
    const idsByBatch = new Map<string, string[]>();
    for (const n of active) {
      const m = n.message.match(/\[batchId:([^\]]+)\]/);
      if (!m) continue;
      const list = idsByBatch.get(m[1]) ?? [];
      list.push(n.id);
      idsByBatch.set(m[1], list);
    }
    if (idsByBatch.size === 0) return 0;

    const liveBatches = await this.prisma.batch.findMany({
      where: { id: { in: [...idsByBatch.keys()] }, quantity: { gt: 0 } },
      select: { id: true },
    });
    const live = new Set(liveBatches.map((b) => b.id));

    const staleIds: string[] = [];
    for (const [batchId, ids] of idsByBatch) {
      if (!live.has(batchId)) staleIds.push(...ids);
    }
    if (staleIds.length === 0) return 0;

    const res = await this.prisma.notification.updateMany({
      where: { id: { in: staleIds } },
      data: { resolvedAt: new Date(), isRead: true },
    });
    return res.count;
  }

  async generateReminderAlerts() {
    const today = new Date();
    const todayDay = today.getDate();
    const month = today.getMonth() + 1; // 1-12
    const year = today.getFullYear();

    // A reminder fires today if it hits its monthly day-of-month, OR if it
    // carries a one-off follow-up date that lands today.
    const startOfToday = new Date(year, today.getMonth(), todayDay);
    const endOfToday = new Date(year, today.getMonth(), todayDay, 23, 59, 59, 999);
    const reminders = await this.prisma.customerReminder.findMany({
      where: {
        isActive: true,
        OR: [
          { dayOfMonth: todayDay },
          { followUpDate: { gte: startOfToday, lte: endOfToday } },
        ],
      },
      include: {
        customer: { select: { name: true, phone: true } },
        products: { select: { productId: true } },
      },
    });

    const startOfMonth = new Date(year, today.getMonth(), 1);

    let created = 0;
    for (const r of reminders) {
      const isFollowUpToday =
        !!r.followUpDate &&
        r.followUpDate >= startOfToday &&
        r.followUpDate <= endOfToday;

      // Customer already repurchased one of this reminder's linked products
      // this month — they've restocked, so skip the nudge (and, since no
      // notification is created, the auto-WhatsApp send never fires either).
      if (r.products.length) {
        const alreadyBought = await this.prisma.invoiceItem.count({
          where: {
            productId: { in: r.products.map((p) => p.productId) },
            invoice: {
              customerId: r.customerId,
              status: { notIn: ['DRAFT', 'CANCELLED'] },
              date: { gte: startOfMonth, lte: today },
            },
          },
        });
        if (alreadyBought > 0) continue;
      }

      // A deliberate one-off follow-up takes precedence over the generic
      // monthly nudge for that day, so we don't double-notify the same reminder.
      // Follow-ups dedup on the concrete date (one alert per follow-up);
      // monthly reminders dedup per month+year.
      const dedupKey = isFollowUpToday
        ? `[reminderId:${r.id}][followup:${year}-${month}-${todayDay}]`
        : `[reminderId:${r.id}][month:${month}][year:${year}]`;
      const existing = await this.prisma.notification.findFirst({
        where: {
          type: NotificationType.SYSTEM,
          message: { contains: dedupKey },
        },
      });
      if (!existing) {
        const phone = r.customer.phone ? ` (${r.customer.phone})` : '';
        await this.createAndEmit(
          {
            type: NotificationType.SYSTEM,
            title: isFollowUpToday ? '⏰ Follow-up Due' : '📅 Customer Reminder',
            message: isFollowUpToday
              ? `${r.title} — Follow-up with ${r.customer.name}${phone} is due today. ${dedupKey}`
              : `${r.title} — Follow up with ${r.customer.name}${phone} today. ${dedupKey}`,
            actionUrl: `/reminders/detail?id=${r.id}`,
            branchId: r.branchId ?? null,
          },
          r.id,
        );
        created++;
      }
    }
    return { created };
  }

  async generatePaymentDueAlerts(branchId?: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: ['UNPAID', 'PARTIAL'] },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        customerName: true,
        customerId: true,
        customer: { select: { phone: true } },
        grandTotal: true,
        amountPaid: true,
        branchId: true,
        date: true,
        dueDate: true,
      },
    });

    const now = new Date();
    let created = 0;
    for (const inv of invoices) {
      const outstanding = Number(inv.grandTotal) - Number(inv.amountPaid);
      const daysOutstanding = Math.floor((now.getTime() - new Date(inv.date).getTime()) / 86_400_000);

      // Payment-due alerts are strictly relative to a due date: only invoices
      // that carry one are eligible, and only once we're within the lead window
      // before it (default 3 days). Invoices without a due date never alert.
      if (!inv.dueDate) continue;
      const daysUntilDue = Math.ceil((new Date(inv.dueDate).getTime() - now.getTime()) / 86_400_000);
      if (daysUntilDue > CUSTOMER_PAYMENT_DUE_BEFORE_DAYS) continue;

      // Reminder policy: nudge once a day for up to PAYMENT_DUE_MAX_REMINDERS
      // days, then stop. A one-time Resolve (or the invoice being paid, which
      // sets resolvedAt via syncPaymentDueForInvoice) ends the reminders early
      // and for good.
      const marker = {
        type: NotificationType.PAYMENT_DUE,
        message: { contains: `[invoiceId:${inv.id}]` },
      };

      // 1) Resolved at any point → never notify again.
      const resolved = await this.prisma.notification.findFirst({
        where: { ...marker, resolvedAt: { not: null } },
        select: { id: true },
      });
      if (resolved) continue;

      // 2) Already sent the full run of daily reminders → stop.
      const sentCount = await this.prisma.notification.count({ where: marker });
      if (sentCount >= PAYMENT_DUE_MAX_REMINDERS) continue;

      // 3) At most one reminder per day — skip if we already sent one in the
      //    last ~20h (guards against a same-day re-run, e.g. a server restart).
      const sentRecently = await this.prisma.notification.findFirst({
        where: { ...marker, createdAt: { gte: new Date(now.getTime() - 20 * 60 * 60 * 1000) } },
        select: { id: true },
      });
      if (sentRecently) continue;

      const nextState: PaymentDueState = buildPaymentDueState({
        outstanding,
        daysOutstanding,
        customerId: inv.customerId ?? null,
        customerName: inv.customerName,
        customerPhone: inv.customer?.phone ?? null,
      });
      await this.createAndEmit(
        {
          type: NotificationType.PAYMENT_DUE,
          title: 'Payment Due',
          message: buildPaymentDueMessage(inv.customerName, outstanding, inv.invoiceNumber, inv.id),
          actionUrl: `/customers/invoices/detail?id=${inv.id}`,
          branchId: inv.branchId ?? branchId ?? null,
          // Carry the due date so the UI can show "Due in Xd / Overdue Xd".
          entityState: { ...nextState, dueDate: inv.dueDate ?? null } as any,
        },
        inv.id,
      );
      created++;
    }
    return { created };
  }

  // Supplier-side mirror of generatePaymentDueAlerts — money the business OWES
  // suppliers on unpaid/partial GRNs (Purchase Entries). Same cadence: nudge
  // once a day for up to PAYMENT_DUE_MAX_REMINDERS days, stop on a one-time
  // Resolve (or when the GRN is paid off).
  async generateSupplierPaymentDueAlerts(branchId?: string) {
    const grns = await this.prisma.gRN.findMany({
      where: {
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        grnNumber: true,
        supplierId: true,
        supplierName: true,
        supplierInvoiceAmount: true,
        amountPaid: true,
        supplierInvoiceDate: true,
        branchId: true,
      },
    });

    const now = new Date();
    let created = 0;
    for (const g of grns) {
      const outstanding = Number(g.supplierInvoiceAmount) - Number(g.amountPaid);
      if (outstanding <= 0.01) continue;
      const daysOutstanding = Math.floor(
        (now.getTime() - new Date(g.supplierInvoiceDate).getTime()) / 86_400_000,
      );
      // Grace period: don't nag until the payment term (default 60 days) elapses.
      if (daysOutstanding < SUPPLIER_PAYMENT_DUE_AFTER_DAYS) continue;

      const marker = {
        type: NotificationType.SUPPLIER_PAYMENT_DUE,
        message: { contains: `[grnId:${g.id}]` },
      };
      // Resolved once → never notify again.
      const resolved = await this.prisma.notification.findFirst({
        where: { ...marker, resolvedAt: { not: null } },
        select: { id: true },
      });
      if (resolved) continue;
      // Cap at the daily-reminder run.
      const sentCount = await this.prisma.notification.count({ where: marker });
      if (sentCount >= PAYMENT_DUE_MAX_REMINDERS) continue;
      // One reminder per day.
      const sentRecently = await this.prisma.notification.findFirst({
        where: { ...marker, createdAt: { gte: new Date(now.getTime() - 20 * 60 * 60 * 1000) } },
        select: { id: true },
      });
      if (sentRecently) continue;

      await this.createAndEmit(
        {
          type: NotificationType.SUPPLIER_PAYMENT_DUE,
          title: 'Supplier Payment Due',
          message: `${g.supplierName} — ₹${outstanding.toFixed(2)} payable · PE ${g.grnNumber}. [grnId:${g.id}]`,
          actionUrl: `/purchase/grn/detail?id=${g.id}`,
          branchId: g.branchId ?? branchId ?? null,
          entityState: {
            kind: 'SUPPLIER_PAYMENT_DUE',
            outstanding,
            daysOutstanding,
            supplierId: g.supplierId,
            supplierName: g.supplierName,
          } as any,
        },
        g.id,
      );
      created++;
    }

    // Reconcile: resolve alerts for GRNs that have since been paid off so they
    // drop out of Unread (no per-payment sync hook for supplier dues yet).
    const resolvedCount = await this.resolveSettledSupplierAlerts(branchId);
    return { created, resolved: resolvedCount };
  }

  private async resolveSettledSupplierAlerts(branchId?: string): Promise<number> {
    const active = await this.prisma.notification.findMany({
      where: {
        type: NotificationType.SUPPLIER_PAYMENT_DUE,
        resolvedAt: null,
        ...(branchId ? { branchId } : {}),
      },
      select: { id: true, message: true },
    });
    const idsByGrn = new Map<string, string[]>();
    for (const n of active) {
      const m = n.message.match(/\[grnId:([^\]]+)\]/);
      if (!m) continue;
      const list = idsByGrn.get(m[1]) ?? [];
      list.push(n.id);
      idsByGrn.set(m[1], list);
    }
    if (idsByGrn.size === 0) return 0;

    // GRNs still owing money (unpaid/partial) — anything else is settled/gone.
    const owing = await this.prisma.gRN.findMany({
      where: { id: { in: [...idsByGrn.keys()] }, paymentStatus: { in: ['UNPAID', 'PARTIAL'] } },
      select: { id: true },
    });
    const owingSet = new Set(owing.map((g) => g.id));

    const staleIds: string[] = [];
    for (const [grnId, ids] of idsByGrn) {
      if (!owingSet.has(grnId)) staleIds.push(...ids);
    }
    if (staleIds.length === 0) return 0;

    const res = await this.prisma.notification.updateMany({
      where: { id: { in: staleIds } },
      data: { resolvedAt: new Date(), isRead: true },
    });
    return res.count;
  }
}
