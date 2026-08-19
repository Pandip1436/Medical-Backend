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
import {
  CADENCE_SETTING_KEY,
  resolveCadence,
  type NotificationCadence,
} from './notification-cadence';
import { isAdminRole } from '../common/roles.util';

// Window-based dedup: don't fire the same alert again within this many hours
// when there's no stronger signal (user hasn't read/resolved/snoozed).
const DEDUP_WINDOW_HOURS = Number(process.env.NOTIFICATION_DEDUP_WINDOW_HOURS ?? 24);
// Once a notification is explicitly resolved by the user, suppress re-firing
// for this long — the user has acknowledged it, we don't need to keep nagging.
const RESOLVED_SUPPRESS_DAYS = Number(process.env.NOTIFICATION_RESOLVED_DAYS ?? 30);
// Marking as read (without resolving) is a softer signal: suppress for a few days.
const READ_SUPPRESS_DAYS = Number(process.env.NOTIFICATION_READ_DAYS ?? 3);

// Which roles a notification TYPE is relevant to — mirrors the Notifications
// page's per-folder `roles` map so the list matches the folders a role is shown.
// Financial/inventory alerts only reach the roles that act on them. Types NOT
// listed here (SYSTEM/reminders, and APPROVAL — governed by recipientId/
// recipientRole) are visible to everyone. Admins bypass this entirely.
const TYPE_ROLE_VISIBILITY: Record<string, string[]> = {
  LOW_STOCK: ['PHARMACIST', 'INVENTORY_MANAGER'],
  EXPIRY: ['PHARMACIST', 'INVENTORY_MANAGER'],
  PAYMENT_DUE: ['PHARMACIST', 'ACCOUNTANT'],
  SUPPLIER_PAYMENT_DUE: ['ACCOUNTANT', 'INVENTORY_MANAGER'],
};

// A Prisma `where` fragment that hides notification types the role may not see.
// Returns null when there's nothing to hide (no role context, or an admin — both
// see everything). Used by findAll AND markAllAsRead so a non-admin can neither
// view nor mark-read another role's alerts (e.g. an inventory manager clearing
// the accountant's Payment Due).
function roleTypeExclusion(role?: string | null): { NOT: { type: { in: string[] } } } | null {
  if (!role || isAdminRole(role)) return null;
  const hidden = Object.entries(TYPE_ROLE_VISIBILITY)
    .filter(([, roles]) => !roles.includes(role))
    .map(([type]) => type);
  return hidden.length ? { NOT: { type: { in: hidden } } } : null;
}

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
//   - resolved BY A PERSON within RESOLVED_SUPPRESS_DAYS → ~30 days quiet
//   - read within READ_SUPPRESS_DAYS                → ~3 days quiet
//   - fallback: any record within DEDUP_WINDOW_HOURS → 24h baseline
// `readDays` overrides the read-suppression window — expiry / low-stock pass
// the admin-configured cadence.stock.reAlertDays (Settings → Notifications);
// everything else falls back to the env default.
function suppressionClauses(readDays: number = READ_SUPPRESS_DAYS): any[] {
  const now = new Date();
  return [
    { isRead: false, resolvedAt: null, snoozedUntil: null },
    { isRead: false, resolvedAt: null, snoozedUntil: { gt: now } },
    // Only a HUMAN "Resolve" buys the 30 days of quiet — that's someone saying
    // "I've dealt with this, stop asking". The reconcilers below auto-resolve
    // alerts whose problem simply went away (product restocked, batch emptied)
    // and leave resolvedById null; those must not silence the next genuine
    // shortage, which for a fast-moving product can be days later.
    { resolvedAt: { gte: daysAgo(RESOLVED_SUPPRESS_DAYS) }, resolvedById: { not: null } },
    { isRead: true, resolvedAt: null, createdAt: { gte: daysAgo(readDays) } },
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

// Reminder cadence — how far before the due date alerts start, and how long
// before an opened-but-unresolved alert asks again — now lives in
// notification-cadence.ts, admin-editable via Settings → Notifications, with
// CUSTOMER_PAYMENT_DUE_BEFORE_DAYS / NOTIFICATION_READ_DAYS as its defaults.

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

  // Admin-editable reminder cadence (Settings → Notifications), stored as one
  // GlobalSetting row. Read once per generator run — a single indexed lookup
  // per sweep, so no caching to go stale after an admin saves a change.
  // Falls back to the env-var defaults when unset or unreadable.
  async getCadence(): Promise<NotificationCadence> {
    try {
      const row = await this.prisma.globalSetting.findUnique({
        where: { key: CADENCE_SETTING_KEY },
        select: { value: true },
      });
      return resolveCadence(row?.value ?? null);
    } catch {
      return resolveCadence(null);
    }
  }

  // Save the cadence from Settings → Notifications. Clamped through
  // resolveCadence before it is stored, so the row can only ever hold values
  // the generators can act on, and the caller gets back exactly what will be
  // used (not the raw input).
  async updateCadence(input: unknown): Promise<NotificationCadence> {
    const value = resolveCadence(input);
    await this.prisma.globalSetting.upsert({
      where: { key: CADENCE_SETTING_KEY },
      update: { value: value as any },
      create: { key: CADENCE_SETTING_KEY, value: value as any },
    });
    return value;
  }

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
    /** The requesting user — sees branch-wide rows PLUS their own personal ones. */
    userId?: string;
    /** The requesting user's role — governs role-targeted rows (e.g. admin-only). */
    role?: string | null;
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
    // Personal targeting: a row with recipientId set is visible ONLY to that
    // user; a null recipient is not user-specific. Without a user context fall
    // back to recipient-null only, so personal notifications never leak.
    and.push(
      opts.userId
        ? { OR: [{ recipientId: null }, { recipientId: opts.userId }] }
        : { recipientId: null },
    );
    // Role targeting: rows tagged with a recipientRole (e.g. 'ADMIN' for
    // approval requests) are visible only to admins. Non-admins see only
    // role-unrestricted rows.
    if (!isAdminRole(opts.role ?? undefined)) {
      and.push({ recipientRole: null });
    }
    // Type visibility: hide alert types this role doesn't act on (e.g. Payment
    // Due for an inventory manager), matching the folders the page shows them.
    const typeExclusion = roleTypeExclusion(opts.role);
    if (typeExclusion) and.push(typeExclusion);
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

  async markAllAsRead(branchId?: string, userId?: string, role?: string | null) {
    return this.prisma.notification.updateMany({
      // Only touch rows this user can actually see: never another user's
      // personal ones, and — for non-admins — never role-restricted (admin) ones.
      where: {
        isRead: false,
        ...(branchId ? { branchId } : {}),
        ...(userId
          ? { OR: [{ recipientId: null }, { recipientId: userId }] }
          : { recipientId: null }),
        ...(isAdminRole(role ?? undefined) ? {} : { recipientRole: null }),
        // Never let a non-admin mark another role's alert types read.
        ...((roleTypeExclusion(role) ?? {}) as any),
      },
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

  // Every alert generator in one call. Used by the external cron tick (see
  // CronService) so the scheduled run has a single entry point; the in-process
  // scheduler keeps its own copy because it additionally gates the reminder
  // generator to business hours on a boot catch-up.
  async runAllAlerts() {
    const [lowStock, expiry, paymentDue, supplierDue, reminders] = await Promise.all([
      this.generateLowStockAlerts(undefined),
      this.generateExpiryAlerts(undefined, 90),
      this.generatePaymentDueAlerts(undefined),
      this.generateSupplierPaymentDueAlerts(undefined),
      this.generateReminderAlerts(),
    ]);
    return {
      lowStock: lowStock.created,
      expiry: expiry.created,
      paymentDue: paymentDue.created,
      supplierDue: supplierDue.created,
      reminders: reminders.created,
    };
  }

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
    const { stock } = await this.getCadence();

    for (const p of lowStock) {
      const marker = `[productId:${p.id}]`;
      // Layered suppression — see suppressionClauses() for the full ruleset.
      // No cap: a product nobody restocks keeps asking every reAlertDays.
      const existing = await this.prisma.notification.findFirst({
        where: {
          type: NotificationType.LOW_STOCK,
          message: { contains: marker },
          OR: suppressionClauses(stock.reAlertDays),
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

    // Close out alerts for products that have since been restocked.
    const resolved = await this.resolveRestockedLowStockAlerts(branchId);
    return { created, resolved };
  }

  async generateExpiryAlerts(branchId?: string, daysAhead = 90) {
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);

    const { stock } = await this.getCadence();
    // How far past its expiry date a batch keeps alerting. Stock that expired
    // longer ago than this is assumed dealt with outside the system (or bad
    // import data) and stays quiet — see cadence.stock.expiredGraceDays.
    const gracePast = new Date();
    gracePast.setDate(gracePast.getDate() - stock.expiredGraceDays);

    const batches = await this.prisma.batch.findMany({
      where: {
        quantity: { gt: 0 },
        expiryDate: {
          gte: gracePast,
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
      const marker = `[batchId:${b.id}]`;
      const daysLeft = Math.ceil((new Date(b.expiryDate).getTime() - now.getTime()) / 86400000);
      // Layered suppression — see suppressionClauses(). No cap: a batch that
      // expires and is never written off keeps asking every reAlertDays, until
      // it's written off (which resolves these alerts — see products.service.ts),
      // sold through, or passes the expiredGraceDays cutoff above.
      const existing = await this.prisma.notification.findFirst({
        where: {
          type: NotificationType.EXPIRY,
          message: { contains: marker },
          OR: suppressionClauses(stock.reAlertDays),
        },
        orderBy: { createdAt: 'desc' },
      });
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

  // Resolve active LOW_STOCK alerts for products that are back above their
  // minimum. Restocking happens through several paths (purchase entry, stock
  // adjustment, sales return, import), none of which touched the alert — so
  // without this the row sat in the Unread list long after the problem was
  // fixed. Reconciled on the sweep rather than hooked into each path, so every
  // way of adding stock is covered by one piece of code. Mirrors
  // resolveStaleExpiryAlerts / resolveSettledSupplierAlerts below.
  private async resolveRestockedLowStockAlerts(branchId?: string): Promise<number> {
    const active = await this.prisma.notification.findMany({
      where: {
        type: NotificationType.LOW_STOCK,
        resolvedAt: null,
        ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      },
      select: { id: true, message: true },
    });
    const idsByProduct = new Map<string, string[]>();
    for (const n of active) {
      const m = n.message.match(/\[productId:([^\]]+)\]/);
      if (!m) continue;
      const list = idsByProduct.get(m[1]) ?? [];
      list.push(n.id);
      idsByProduct.set(m[1], list);
    }
    if (idsByProduct.size === 0) return 0;

    // Same "is it low?" test the generator above uses.
    const products = await this.prisma.product.findMany({
      where: { id: { in: [...idsByProduct.keys()] } },
      select: { id: true, totalStock: true, minStock: true },
    });
    const stillLow = new Set(
      products
        .filter((p) => p.totalStock <= 0 || (p.minStock > 0 && p.totalStock <= p.minStock))
        .map((p) => p.id),
    );

    const fixedIds: string[] = [];
    for (const [productId, ids] of idsByProduct) {
      if (!stillLow.has(productId)) fixedIds.push(...ids);
    }
    if (fixedIds.length === 0) return 0;

    const res = await this.prisma.notification.updateMany({
      where: { id: { in: fixedIds } },
      data: { resolvedAt: new Date(), isRead: true },
    });
    return res.count;
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
    // carries a one-off follow-up date that lands today. Days 29–31 clamp to the
    // month's last day: on that day, sweep in any dayOfMonth >= today so an
    // end-of-month reminder (e.g. day 31) still fires on Feb 28 / Apr 30.
    const startOfToday = new Date(year, today.getMonth(), todayDay);
    const endOfToday = new Date(year, today.getMonth(), todayDay, 23, 59, 59, 999);
    const lastDay = new Date(year, today.getMonth() + 1, 0).getDate();
    const dayMatch = todayDay === lastDay ? { gte: todayDay } : todayDay;
    const reminders = await this.prisma.customerReminder.findMany({
      where: {
        isActive: true,
        OR: [
          { dayOfMonth: dayMatch },
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
    const { customerDue } = await this.getCadence();
    for (const inv of invoices) {
      const outstanding = Number(inv.grandTotal) - Number(inv.amountPaid);
      const daysOutstanding = Math.floor((now.getTime() - new Date(inv.date).getTime()) / 86_400_000);

      // Payment-due alerts are strictly relative to a due date: only invoices
      // that carry one are eligible, and only once we're within the lead window
      // before it (Settings → Notifications, default 3 days). Invoices without
      // a due date never alert.
      if (!inv.dueDate) continue;
      const daysUntilDue = Math.ceil((new Date(inv.dueDate).getTime() - now.getTime()) / 86_400_000);
      if (daysUntilDue > customerDue.beforeDays) continue;

      // Reminder policy: ask once, then again every `reAlertDays` after the
      // alert has been OPENED and the invoice still isn't settled — the same
      // rule the stock alerts use (suppressionClauses). An unread alert is
      // already in the folder, so it never duplicates itself. Reminders end
      // when the invoice is paid (syncPaymentDueForInvoice sets resolvedAt) or
      // somebody hits Resolve.
      const marker = {
        type: NotificationType.PAYMENT_DUE,
        message: { contains: `[invoiceId:${inv.id}]` },
      };

      // Resolved at any point → never notify again.
      const resolved = await this.prisma.notification.findFirst({
        where: { ...marker, resolvedAt: { not: null } },
        select: { id: true },
      });
      if (resolved) continue;

      const suppressed = await this.prisma.notification.findFirst({
        where: { ...marker, OR: suppressionClauses(customerDue.reAlertDays) },
        select: { id: true },
      });
      if (suppressed) continue;

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
  // suppliers on unpaid/partial GRNs (Purchase Entries). Same shape of cadence,
  // configured separately under cadence.supplierDue; stops on a one-time
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
        dueDate: true,
        branchId: true,
        supplier: { select: { paymentTerms: true } },
      },
    });

    // Credit-term length in days → fallback due date when a GRN has no explicit
    // dueDate. Unknown/absent terms fall back to the legacy grace window so
    // behaviour is unchanged for suppliers without a resolvable term.
    const termDays = (terms?: string | null): number => {
      switch (terms) {
        case 'NET_45':
          return 45;
        case 'NET_60':
          return 60;
        case 'NET_30':
          return 30;
        default:
          return SUPPLIER_PAYMENT_DUE_AFTER_DAYS;
      }
    };

    const now = new Date();
    let created = 0;
    const { supplierDue } = await this.getCadence();
    for (const g of grns) {
      const outstanding = Number(g.supplierInvoiceAmount) - Number(g.amountPaid);
      if (outstanding <= 0.01) continue;
      // Fire off the payment DUE DATE (mirrors the Payments Due screen /
      // SuppliersService.getPaymentsDue), not "N days since the invoice". Use
      // the explicit GRN.dueDate captured in Purchase Entry, else fall back to
      // supplierInvoiceDate + the supplier's credit term.
      const effectiveDue = g.dueDate
        ? new Date(g.dueDate)
        : new Date(
            new Date(g.supplierInvoiceDate).getTime() +
              termDays(g.supplier?.paymentTerms) * 86_400_000,
          );
      const daysOutstanding = Math.floor(
        (now.getTime() - effectiveDue.getTime()) / 86_400_000,
      );
      // Not due yet — nothing to nudge about until we're inside the lead window
      // (Settings → Notifications; 0 = start on the due date, the old behaviour).
      if (daysOutstanding < -supplierDue.beforeDays) continue;

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
      // Same read-then-ask-again rule as the customer side.
      const suppressed = await this.prisma.notification.findFirst({
        where: { ...marker, OR: suppressionClauses(supplierDue.reAlertDays) },
        select: { id: true },
      });
      if (suppressed) continue;

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
