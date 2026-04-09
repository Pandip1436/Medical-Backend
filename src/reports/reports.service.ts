import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import dayjs from 'dayjs';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardKpis() {
    const today = dayjs().startOf('day').toDate();
    const startOfMonth = dayjs().startOf('month').toDate();

    // 1. Calculate Total Sales (Today & Month)
    const sales = await this.prisma.invoice.aggregate({
      where: { date: { gte: startOfMonth } },
      _sum: { grandTotal: true },
    });
    const todaysSales = await this.prisma.invoice.aggregate({
      where: { date: { gte: today } },
      _sum: { grandTotal: true },
    });

    // 2. Outstanding Receivables
    const outstanding = await this.prisma.customer.aggregate({
      _sum: { currentOutstanding: true }
    });

    // 3. Expiry Alerts (Batches expiring within 90 days)
    const ninetyDaysFromNow = dayjs().add(90, 'days').toDate();
    const expiryCount = await this.prisma.batch.count({
      where: {
        expiryDate: { lte: ninetyDaysFromNow, gte: new Date() },
        quantity: { gt: 0 }
      }
    });

    // 4. Low Stock Alerts
    const products = await this.prisma.product.findMany({
      select: { id: true, totalStock: true, minStock: true }
    });
    const lowStockCount = products.filter(p => p.totalStock <= p.minStock).length;

    // 5. Total Products in Catalog
    const totalProducts = await this.prisma.product.count();

    // 6. Recent Invoices
    const recentInvoices = await this.prisma.invoice.findMany({
      take: 5,
      orderBy: { date: 'desc' },
      include: { items: { select: { productName: true, quantity: true } } }
    });

    return {
      monthlySales: sales._sum.grandTotal || 0,
      todaysSales: todaysSales._sum.grandTotal || 0,
      totalOutstanding: outstanding._sum.currentOutstanding || 0,
      expiringBatchesCount: expiryCount,
      lowStockAlertsCount: lowStockCount,
      totalProducts,
      recentInvoices
    };
  }
}
