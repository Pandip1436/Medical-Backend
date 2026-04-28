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
let NotificationsService = class NotificationsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        return this.prisma.notification.create({ data: dto });
    }
    async findAll(branchId, onlyUnread) {
        const where = {};
        if (branchId)
            where.OR = [{ branchId }, { branchId: null }];
        if (onlyUnread)
            where.isRead = false;
        return this.prisma.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 200,
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
    async remove(id) {
        return this.prisma.notification.delete({ where: { id } });
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
                    isRead: false,
                    message: { contains: `[productId:${p.id}]` },
                },
            });
            if (!existing) {
                const stockLabel = p.totalStock <= 0
                    ? 'is out of stock'
                    : `has only ${p.totalStock} units left (min: ${p.minStock})`;
                await this.prisma.notification.create({
                    data: {
                        type: create_notification_dto_1.NotificationType.LOW_STOCK,
                        title: 'Low Stock Alert',
                        message: `${p.name} ${stockLabel}. [productId:${p.id}]`,
                        actionUrl: `/inventory/products`,
                        branchId: p.branchId ?? branchId ?? null,
                    },
                });
                created++;
            }
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
                    isRead: false,
                    message: { contains: `[batchId:${b.id}]` },
                },
            });
            if (!existing) {
                const daysLeft = Math.ceil((new Date(b.expiryDate).getTime() - now.getTime()) / 86400000);
                const label = daysLeft <= 0 ? 'has already expired' : `expires in ${daysLeft} day(s)`;
                await this.prisma.notification.create({
                    data: {
                        type: create_notification_dto_1.NotificationType.EXPIRY,
                        title: daysLeft <= 0 ? 'Expired Stock' : 'Expiry Alert',
                        message: `Batch ${b.batchNumber} of ${b.product.name} ${label}. [batchId:${b.id}]`,
                        actionUrl: `/inventory/expiry`,
                        branchId: b.product.branchId ?? branchId ?? null,
                    },
                });
                created++;
            }
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
                        actionUrl: `/reminders`,
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
            },
        });
        let created = 0;
        for (const inv of invoices) {
            const outstanding = Number(inv.grandTotal) - Number(inv.amountPaid);
            const existing = await this.prisma.notification.findFirst({
                where: {
                    type: create_notification_dto_1.NotificationType.PAYMENT_DUE,
                    isRead: false,
                    message: { contains: `[invoiceId:${inv.id}]` },
                },
            });
            if (!existing) {
                await this.prisma.notification.create({
                    data: {
                        type: create_notification_dto_1.NotificationType.PAYMENT_DUE,
                        title: 'Payment Due',
                        message: `Invoice ${inv.invoiceNumber} for ${inv.customerName} has ₹${outstanding.toFixed(2)} outstanding. [invoiceId:${inv.id}]`,
                        actionUrl: `/customers/invoices`,
                        branchId: inv.branchId ?? branchId ?? null,
                    },
                });
                created++;
            }
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