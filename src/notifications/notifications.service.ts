import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto, NotificationType } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateNotificationDto) {
    return this.prisma.notification.create({ data: dto });
  }

  async findAll(branchId?: string, onlyUnread?: boolean) {
    const where: any = {};
    // Include notifications for the branch AND notifications with no branch (global/unassigned)
    if (branchId) where.OR = [{ branchId }, { branchId: null }];
    if (onlyUnread) where.isRead = false;
    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
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

  async remove(id: string) {
    return this.prisma.notification.delete({ where: { id } });
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
      // Use exact marker [productId:X] so the dedup check is precise
      const existing = await this.prisma.notification.findFirst({
        where: {
          type: NotificationType.LOW_STOCK,
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
            type: NotificationType.LOW_STOCK,
            title: 'Low Stock Alert',
            message: `${p.name} ${stockLabel}. [productId:${p.id}]`,
            actionUrl: `/inventory/products`,
            branchId: p.branchId ?? branchId ?? null,  // tag with active branch if product has none
          },
        });
        created++;
      }
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
      const existing = await this.prisma.notification.findFirst({
        where: {
          type: NotificationType.EXPIRY,
          isRead: false,
          message: { contains: `[batchId:${b.id}]` },
        },
      });
      if (!existing) {
        const daysLeft = Math.ceil((new Date(b.expiryDate).getTime() - now.getTime()) / 86400000);
        const label = daysLeft <= 0 ? 'has already expired' : `expires in ${daysLeft} day(s)`;
        await this.prisma.notification.create({
          data: {
            type: NotificationType.EXPIRY,
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

  async generatePaymentDueAlerts(branchId?: string) {
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
          type: NotificationType.PAYMENT_DUE,
          isRead: false,
          message: { contains: `[invoiceId:${inv.id}]` },
        },
      });
      if (!existing) {
        await this.prisma.notification.create({
          data: {
            type: NotificationType.PAYMENT_DUE,
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
}
