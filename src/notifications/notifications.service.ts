import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto, NotificationType } from './dto/create-notification.dto';

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
type PaymentDueState = { kind: 'PAYMENT_DUE'; outstanding: number; daysOutstanding: number };

// How much worse the situation must be to override suppression
const LOW_STOCK_DROP_PCT = 0.25;    // stock dropped 25%+ from last snapshot
const PAYMENT_GROWTH_PCT = 0.10;    // outstanding grew 10%+ since last alert
const PAYMENT_AGE_BUMP_DAYS = 30;   // OR invoice aged 30+ more days

function shouldEscalateLowStock(prev: LowStockState | null, next: LowStockState): boolean {
  if (!prev) return true; // legacy row, treat as needing refresh
  // Was above min, now below — definitely re-alert (the situation regressed).
  if (prev.totalStock > prev.minStock && next.totalStock <= next.minStock) return true;
  // Stock dropped meaningfully.
  if (next.totalStock < prev.totalStock * (1 - LOW_STOCK_DROP_PCT)) return true;
  return false;
}
function shouldEscalatePaymentDue(prev: PaymentDueState | null, next: PaymentDueState): boolean {
  if (!prev) return true;
  // Outstanding grew (e.g. extra credit added to the same invoice).
  if (next.outstanding > prev.outstanding * (1 + PAYMENT_GROWTH_PCT)) return true;
  // Invoice aged another month without payment — re-poke.
  if (next.daysOutstanding - prev.daysOutstanding >= PAYMENT_AGE_BUMP_DAYS) return true;
  return false;
}
// Expiry: the batch's expiry date is fixed; once acknowledged, never re-fire
// for the same batch (the suppression window naturally covers it).
function shouldEscalateExpiry(_prev: ExpiryState | null, _next: ExpiryState): boolean {
  return false;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateNotificationDto) {
    return this.prisma.notification.create({ data: dto });
  }

  async findAll(branchId?: string, onlyUnread?: boolean) {
    const now = new Date();
    // Each AND clause must be satisfied. Using an explicit array avoids the
    // top-level-OR-overrides-everything pitfall when mixing OR + branch + read filters.
    const and: any[] = [
      // Hide actively-snoozed; ones whose snooze window has elapsed come back automatically.
      { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
    ];
    if (branchId) {
      and.push({ OR: [{ branchId }, { branchId: null }] });
    }
    if (onlyUnread) and.push({ isRead: false });
    return this.prisma.notification.findMany({
      where: { AND: and },
      orderBy: { createdAt: 'desc' },
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
    return this.prisma.notification.update({
      where: { id },
      data: { resolvedAt: new Date(), resolvedById: userId ?? null, isRead: true },
    });
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
      select: { id: true, name: true, totalStock: true, minStock: true, branchId: true },
    });

    const lowStock = products.filter((p) => {
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
      await this.prisma.notification.create({
        data: {
          type: NotificationType.LOW_STOCK,
          title: 'Low Stock Alert',
          message: `${p.name} ${stockLabel}. [productId:${p.id}]`,
          actionUrl: `/inventory/product-history?productId=${p.id}`,  // already acts as product detail
          branchId: p.branchId ?? branchId ?? null,  // tag with active branch if product has none
          entityState: nextState as any,
        },
      });
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
      await this.prisma.notification.create({
        data: {
          type: NotificationType.EXPIRY,
          title: daysLeft <= 0 ? 'Expired Stock' : 'Expiry Alert',
          message: `Batch ${b.batchNumber} of ${b.product.name} ${label}. [batchId:${b.id}]`,
          actionUrl: `/inventory/batches/detail?id=${b.id}`,
          branchId: b.product.branchId ?? branchId ?? null,
          entityState: nextState as any,
        },
      });
      created++;
    }
    return { created };
  }

  async generateReminderAlerts() {
    const today = new Date();
    const todayDay = today.getDate();
    const month = today.getMonth() + 1; // 1-12
    const year = today.getFullYear();

    // Find all reminders due today
    const reminders = await this.prisma.customerReminder.findMany({
      where: { dayOfMonth: todayDay },
      include: { customer: { select: { name: true } } },
    });

    let created = 0;
    for (const r of reminders) {
      // Dedup: one notification per reminder per month+year
      const dedupKey = `[reminderId:${r.id}][month:${month}][year:${year}]`;
      const existing = await this.prisma.notification.findFirst({
        where: {
          type: NotificationType.SYSTEM,
          message: { contains: dedupKey },
        },
      });
      if (!existing) {
        await this.prisma.notification.create({
          data: {
            type: NotificationType.SYSTEM,
            title: '📅 Customer Reminder',
            message: `${r.title} — Follow up with ${r.customer.name} today. ${dedupKey}`,
            actionUrl: `/reminders/detail?id=${r.id}`,
            branchId: r.branchId ?? null,
          },
        });
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
        grandTotal: true,
        amountPaid: true,
        branchId: true,
        date: true,
      },
    });

    const now = new Date();
    let created = 0;
    for (const inv of invoices) {
      const outstanding = Number(inv.grandTotal) - Number(inv.amountPaid);
      const daysOutstanding = Math.floor((now.getTime() - new Date(inv.date).getTime()) / 86_400_000);
      // Layered suppression — see suppressionClauses().
      const existing = await this.prisma.notification.findFirst({
        where: {
          type: NotificationType.PAYMENT_DUE,
          message: { contains: `[invoiceId:${inv.id}]` },
          OR: suppressionClauses(),
        },
        orderBy: { createdAt: 'desc' },
      });
      const nextState: PaymentDueState = {
        kind: 'PAYMENT_DUE',
        outstanding,
        daysOutstanding,
      };
      // Suppressed AND outstanding hasn't grown / invoice hasn't aged enough — skip.
      if (existing && !shouldEscalatePaymentDue(existing.entityState as PaymentDueState | null, nextState)) {
        continue;
      }
      await this.prisma.notification.create({
        data: {
          type: NotificationType.PAYMENT_DUE,
          title: 'Payment Due',
          message: `Invoice ${inv.invoiceNumber} for ${inv.customerName} has ₹${outstanding.toFixed(2)} outstanding. [invoiceId:${inv.id}]`,
          actionUrl: `/customers/invoices/detail?id=${inv.id}`,
          branchId: inv.branchId ?? branchId ?? null,
          entityState: nextState as any,
        },
      });
      created++;
    }
    return { created };
  }
}
