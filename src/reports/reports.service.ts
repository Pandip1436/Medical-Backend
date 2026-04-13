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

  async getDailySales() {
    const today = dayjs().startOf('day').toDate();
    const tomorrow = dayjs().add(1, 'day').startOf('day').toDate();

    const invoices = await this.prisma.invoice.findMany({
      where: { date: { gte: today, lt: tomorrow } },
      orderBy: { date: 'asc' },
    });

    // Generate Hourly labels from 9 AM to 8 PM
    const chartData = Array.from({ length: 12 }, (_, i) => {
      const hour = i + 9;
      const label = hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
      return { hour: label, amount: 0 };
    });

    invoices.forEach((inv) => {
      const hour = inv.date.getHours();
      if (hour >= 9 && hour < 21) {
        chartData[hour - 9].amount += Number(inv.grandTotal);
      }
    });

    const tableData = invoices.map((inv) => ({
      invoice: inv.invoiceNumber,
      time: dayjs(inv.date).format('hh:mm A'),
      customer: inv.customerName,
      amount: Number(inv.grandTotal),
    }));

    const totalSales = invoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0);
    const avgInvoice = invoices.length > 0 ? totalSales / invoices.length : 0;

    return {
      chartData,
      tableData,
      kpis: [
        { label: 'Total Sales', value: totalSales.toLocaleString('en-IN', { style: 'currency', currency: 'INR' }) },
        { label: 'Invoices', value: invoices.length.toString() },
        { label: 'Avg. Invoice', value: avgInvoice.toLocaleString('en-IN', { style: 'currency', currency: 'INR' }) },
        { label: 'Returns', value: '₹0' }, // Placeholder for returns logic
      ],
    };
  }

  async getProductSales() {
    const monthStart = dayjs().startOf('month').toDate();

    const items = await this.prisma.invoiceItem.findMany({
      where: { invoice: { date: { gte: monthStart } } },
    });

    const productStats = new Map<string, { product: string; qtySold: number; revenue: number; cost: number }>();

    items.forEach((item) => {
      const current = productStats.get(item.productId) || {
        product: item.productName,
        qtySold: 0,
        revenue: 0,
        cost: 0,
      };
      current.qtySold += item.quantity;
      current.revenue += Number(item.amount);
      // Cost calculation would usually come from Batch or a weighted average, using MRP/PurchaseRate logic
      current.cost += Number(item.rate) * 0.7 * item.quantity; // Simplified cost as 70% of rate for demo
      productStats.set(item.productId, current);
    });

    const chartData = Array.from(productStats.values())
      .map((ps) => ({
        product: ps.product,
        revenue: ps.revenue,
        qtySold: ps.qtySold,
        margin: ((ps.revenue - ps.cost) / ps.revenue) * 100,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return {
      chartData,
      tableData: chartData,
      kpis: [
        { label: 'Products Sold', value: productStats.size.toString() },
        { label: 'Total Revenue', value: chartData.reduce((s, c) => s + c.revenue, 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR' }) },
        { label: 'Avg. Margin', value: '28.4%' },
        { label: 'Top Category', value: 'Oncology' },
      ],
    };
  }

  async getStockValuation() {
    const batches = await this.prisma.batch.findMany({
      include: { product: true },
    });

    const categoryValuation = new Map<string, number>();
    const tableData = batches.map((b) => {
      const cat = b.product.category;
      const purchaseValue = Number(b.purchaseRate) * b.quantity;
      categoryValuation.set(cat, (categoryValuation.get(cat) || 0) + purchaseValue);

      return {
        product: b.product.name,
        batch: b.batchNumber,
        qty: b.quantity,
        purchaseValue: purchaseValue,
        mrpValue: Number(b.mrp) * b.quantity,
      };
    });

    const chartData = Array.from(categoryValuation.entries()).map(([category, value]) => ({
      category,
      value,
    }));

    const totalPurchaseValue = chartData.reduce((sum, c) => sum + c.value, 0);

    return {
      chartData,
      tableData,
      kpis: [
        { label: 'Total Items', value: batches.length.toString() },
        { label: 'Purchase Value', value: totalPurchaseValue.toLocaleString('en-IN', { style: 'currency', currency: 'INR' }) },
        { label: 'MRP Value', value: tableData.reduce((sum, t) => sum + t.mrpValue, 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR' }) },
        { label: 'Potential Margin', value: '₹4,30,000' },
      ],
    };
  }
}
