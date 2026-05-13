"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const create_notification_dto_1 = require("./dto/create-notification.dto");
const DEDUP_WINDOW_HOURS = Number(process.env.NOTIFICATION_DEDUP_WINDOW_HOURS ?? 24);
const RESOLVED_SUPPRESS_DAYS = Number(process.env.NOTIFICATION_RESOLVED_DAYS ?? 30);
const READ_SUPPRESS_DAYS = Number(process.env.NOTIFICATION_READ_DAYS ?? 3);
function dedupSince() {
    const d = new Date();
    d.setHours(d.getHours() - DEDUP_WINDOW_HOURS);
    return d;
}
function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}
function suppressionClauses() {
    const now = new Date();
    return [
        { isRead: false, resolvedAt: null, snoozedUntil: null },
        { isRead: false, resolvedAt: null, snoozedUntil: { gt: now } },
        { resolvedAt: { gte: daysAgo(RESOLVED_SUPPRESS_DAYS) } },
        { isRead: true, resolvedAt: null, createdAt: { gte: daysAgo(READ_SUPPRESS_DAYS) } },
        { createdAt: { gte: dedupSince() } },
    ];
}
const LOW_STOCK_DROP_PCT = 0.25;
const PAYMENT_GROWTH_PCT = 0.10;
const PAYMENT_AGE_BUMP_DAYS = 30;
function shouldEscalateLowStock(prev, next) {
    if (!prev)
        return true;
    if (prev.totalStock > prev.minStock && next.totalStock <= next.minStock)
        return true;
    if (next.totalStock < prev.totalStock * (1 - LOW_STOCK_DROP_PCT))
        return true;
    return false;
}
function shouldEscalatePaymentDue(prev, next) {
    if (!prev)
        return true;
    if (next.outstanding > prev.outstanding * (1 + PAYMENT_GROWTH_PCT))
        return true;
    if (next.daysOutstanding - prev.daysOutstanding >= PAYMENT_AGE_BUMP_DAYS)
        return true;
    return false;
}
function shouldEscalateExpiry(_prev, _next) {
    return false;
}
let NotificationsService = class NotificationsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        return this.prisma.notification.create({ data: dto });
    }
    async findAll(branchId, onlyUnread) {
        const now = new Date();
        const and = [
            { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
        ];
        if (branchId) {
            and.push({ OR: [{ branchId }, { branchId: null }] });
        }
        if (onlyUnread)
            and.push({ isRead: false });
        return this.prisma.notification.findMany({
            where: { AND: and },
            orderBy: { createdAt: 'desc' },
            take: 1000,
        });
    }
    async markAsRead(id) {
        return this.prisma.notification.update({ where: { id }, data: { isRead: true } });
    }
    async markAllAsRead(branchId) {
        return this.prisma.notification.updateMany({
            where: { isRead: false, ...(branchId ? { branchId } : {}) },
            data: { isRead: true },
        });
    }
    async markManyAsRead(ids) {
        if (!ids.length)
            return { count: 0 };
        return this.prisma.notification.updateMany({
            where: { id: { in: ids } },
            data: { isRead: true },
        });
    }
    async snooze(id, until) {
        return this.prisma.notification.update({
            where: { id },
            data: { snoozedUntil: until },
        });
    }
    async resolve(id, userId) {
        return this.prisma.notification.update({
            where: { id },
            data: { resolvedAt: new Date(), resolvedById: userId ?? null, isRead: true },
        });
    }
    async remove(id) {
        return this.prisma.notification.delete({ where: { id } });
    }
    async removeMany(ids) {
        if (!ids.length)
            return { count: 0 };
        return this.prisma.notification.deleteMany({
            where: { id: { in: ids } },
        });
    }
    async clearAll(branchId) {
        return this.prisma.notification.deleteMany({
            where: branchId ? { branchId } : {},
        });
    }
    async generateLowStockAlerts(branchId) {
        const products = await this.prisma.product.findMany({
            where: {
                isActive: true,
                ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
            },
            select: { id: true, name: true, totalStock: true, minStock: true, branchId: true },
        });
        const lowStock = products.filter((p) => {
            if (p.totalStock <= 0)
                return true;
            if (p.minStock > 0 && p.totalStock <= p.minStock)
                return true;
            return false;
        });
        let created = 0;
        for (const p of lowStock) {
            const existing = await this.prisma.notification.findFirst({
                where: {
                    type: create_notification_dto_1.NotificationType.LOW_STOCK,
                    message: { contains: `[productId:${p.id}]` },
                    OR: suppressionClauses(),
                },
                orderBy: { createdAt: 'desc' },
            });
            const nextState = {
                kind: 'LOW_STOCK',
                totalStock: p.totalStock,
                minStock: p.minStock,
            };
            if (existing && !shouldEscalateLowStock(existing.entityState, nextState)) {
                continue;
            }
            const stockLabel = p.totalStock <= 0
                ? 'is out of stock'
                : `has only ${p.totalStock} units left (min: ${p.minStock})`;
            await this.prisma.notification.create({
                data: {
                    type: create_notification_dto_1.NotificationType.LOW_STOCK,
                    title: 'Low Stock Alert',
                    message: `${p.name} ${stockLabel}. [productId:${p.id}]`,
                    actionUrl: `/inventory/product-history?productId=${p.id}`,
                    branchId: p.branchId ?? branchId ?? null,
                    entityState: nextState,
                },
            });
            created++;
        }
        return { created };
    }
    async generateExpiryAlerts(branchId, daysAhead = 90) {
        const now = new Date();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + daysAhead);
        const gracePast = new Date();
        gracePast.setDate(gracePast.getDate() - 30);
        const batches = await this.prisma.batch.findMany({
            where: {
                quantity: { gt: 0 },
                expiryDate: {
                    gte: gracePast,
                    lte: cutoff,
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
            const existing = await this.prisma.notification.findFirst({
                where: {
                    type: create_notification_dto_1.NotificationType.EXPIRY,
                    message: { contains: `[batchId:${b.id}]` },
                    OR: suppressionClauses(),
                },
                orderBy: { createdAt: 'desc' },
            });
            const daysLeft = Math.ceil((new Date(b.expiryDate).getTime() - now.getTime()) / 86400000);
            const nextState = { kind: 'EXPIRY', daysLeft };
            if (existing && !shouldEscalateExpiry(existing.entityState, nextState)) {
                continue;
            }
            const label = daysLeft <= 0 ? 'has already expired' : `expires in ${daysLeft} day(s)`;
            await this.prisma.notification.create({
                data: {
                    type: create_notification_dto_1.NotificationType.EXPIRY,
                    title: daysLeft <= 0 ? 'Expired Stock' : 'Expiry Alert',
                    message: `Batch ${b.batchNumber} of ${b.product.name} ${label}. [batchId:${b.id}]`,
                    actionUrl: `/inventory/batches/detail?id=${b.id}`,
                    branchId: b.product.branchId ?? branchId ?? null,
                    entityState: nextState,
                },
            });
            created++;
        }
        return { created };
    }
    async generateReminderAlerts() {
        const today = new Date();
        const todayDay = today.getDate();
        const month = today.getMonth() + 1;
        const year = today.getFullYear();
        const reminders = await this.prisma.customerReminder.findMany({
            where: { dayOfMonth: todayDay },
            include: { customer: { select: { name: true } } },
        });
        let created = 0;
        for (const r of reminders) {
            const dedupKey = `[reminderId:${r.id}][month:${month}][year:${year}]`;
            const existing = await this.prisma.notification.findFirst({
                where: {
                    type: create_notification_dto_1.NotificationType.SYSTEM,
                    message: { contains: dedupKey },
                },
            });
            if (!existing) {
                await this.prisma.notification.create({
                    data: {
                        type: create_notification_dto_1.NotificationType.SYSTEM,
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
    async generatePaymentDueAlerts(branchId) {
        const invoices = await this.prisma.invoice.findMany({
            where: {
                status: { in: ['CREDIT', 'PARTIAL'] },
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
            const existing = await this.prisma.notification.findFirst({
                where: {
                    type: create_notification_dto_1.NotificationType.PAYMENT_DUE,
                    message: { contains: `[invoiceId:${inv.id}]` },
                    OR: suppressionClauses(),
                },
                orderBy: { createdAt: 'desc' },
            });
            const nextState = {
                kind: 'PAYMENT_DUE',
                outstanding,
                daysOutstanding,
            };
            if (existing && !shouldEscalatePaymentDue(existing.entityState, nextState)) {
                continue;
            }
            await this.prisma.notification.create({
                data: {
                    type: create_notification_dto_1.NotificationType.PAYMENT_DUE,
                    title: 'Payment Due',
                    message: `Invoice ${inv.invoiceNumber} for ${inv.customerName} has ₹${outstanding.toFixed(2)} outstanding. [invoiceId:${inv.id}]`,
                    actionUrl: `/customers/invoices/detail?id=${inv.id}`,
                    branchId: inv.branchId ?? branchId ?? null,
                    entityState: nextState,
                },
            });
            created++;
        }
        return { created };
    }
};
exports.NotificationsService = NotificationsService;
exports.NotificationsService = NotificationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], NotificationsService);
//# sourceMappingURL=notifications.service.js.map