import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import dayjs from 'dayjs';

type PeriodQuery = { from?: string; to?: string; branchId?: string };

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customersService: CustomersService,
  ) {}

  // ── Shared helpers ─────────────────────────────────────────────
  private resolvePeriod(q: PeriodQuery) {
    const from = q.from ? dayjs(q.from).startOf('day').toDate() : dayjs().startOf('month').toDate();
    const to = q.to ? dayjs(q.to).endOf('day').toDate() : dayjs().endOf('day').toDate();
    return { from, to, branchId: q.branchId };
  }

  private branchFilter(branchId?: string) {
    return branchId ? { branchId } : {};
  }

  private inr(value: number) {
    return value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  }

  // Round a money value to 2 decimal places. Use at every aggregation
  // projection step that derives a value by division/multiplication (e.g.
  // taxable = amount / (1 + rate/100)) before it leaves the service —
  // otherwise IEEE-754 noise leaks into JSON/CSV exports that accountants
  // use for GST filing.
  private roundCurrency(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  // ── Dashboard ──────────────────────────────────────────────────
  // Default page size for the dashboard "Needs attention" / "Recent activity"
  // cards. The first page ships inside getDashboardKpis(); subsequent pages are
  // fetched lazily by the card's infinite scroll via the paginated endpoints.
  private static readonly DASH_PAGE = 20;

  async getDashboardKpis(branchId?: string) {
    const today = dayjs().startOf('day').toDate();
    const startOfMonth = dayjs().startOf('month').toDate();
    const take = ReportsService.DASH_PAGE;

    const bFilter = this.branchFilter(branchId);
    const sales = await this.prisma.invoice.aggregate({
      where: { date: { gte: startOfMonth }, ...bFilter },
      _sum: { grandTotal: true },
    });
    const todaysSales = await this.prisma.invoice.aggregate({
      where: { date: { gte: today }, ...bFilter },
      _sum: { grandTotal: true },
    });
    // Canonical "outstanding" rolls up the same live invoice query used by
    // /customers/summary and /customers/outstanding. See
    // CustomersService.computeLiveOutstanding() for the rule. (Phase 3 bug #1.)
    const outstanding = await this.customersService.computeLiveOutstanding(branchId);

    const expiring = await this.getDashboardExpiring(branchId, 0, take);
    const low = await this.computeLowStock(branchId);
    const overdue = await this.computeOverdueCustomers(branchId);

    const recentInvoicesRaw = await this.prisma.invoice.findMany({
      take,
      orderBy: { date: 'desc' },
      where: { ...bFilter },
      include: {
        items: { select: { productName: true, quantity: true } },
        // Live phone via the customer relation so the activity timeline can
        // render "name + phone" on the first page too (mirrors getDashboardActivity).
        customer: { select: { phone: true } },
      },
    });
    // Surface the joined phone as a top-level `customerPhone`, matching the
    // shape the paginated /dashboard/activity endpoint returns.
    const recentInvoices = recentInvoicesRaw.map((r) => ({
      ...r,
      customerPhone: r.customer?.phone ?? null,
    }));
    const recentInvoicesCount = await this.prisma.invoice.count({ where: { ...bFilter } });

    return {
      monthlySales: sales._sum.grandTotal || 0,
      todaysSales: todaysSales._sum.grandTotal || 0,
      totalOutstanding: outstanding.totalOutstanding,
      expiringBatchesCount: expiring.total,
      lowStockAlertsCount: low.total,
      outOfStockCount: low.outOfStockCount,
      totalProducts: low.totalProducts,
      recentInvoices,
      recentInvoicesCount,
      lowStockItems: low.items.slice(0, take),
      expiringBatches: expiring.items,
      overdueCustomers: overdue.all.slice(0, take),
      overdueCustomersCount: overdue.total,
      overdueTotal: overdue.totalAmount,
    };
  }

  // ── Dashboard cards: paginated lazy-load endpoints ─────────────
  // Each returns { items, total } so the card can show "X of Y" and stop
  // fetching once items.length === total. branchId/skip/take come from the
  // controller; skip/take are coerced + clamped in normalizePage().
  private normalizePage(skip?: number, take?: number) {
    const s = Number.isFinite(skip) && (skip as number) > 0 ? Math.floor(skip as number) : 0;
    const t = Number.isFinite(take) && (take as number) > 0 ? Math.min(Math.floor(take as number), 100) : ReportsService.DASH_PAGE;
    return { skip: s, take: t };
  }

  async getDashboardActivity(branchId?: string, skip?: number, take?: number) {
    const page = this.normalizePage(skip, take);
    const bFilter = this.branchFilter(branchId);
    const where = { ...bFilter };
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          invoiceNumber: true,
          customerName: true,
          date: true,
          // Live phone via the customer relation so the activity timeline
          // can render "name + phone" without a follow-up lookup.
          customer: { select: { phone: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      customerName: r.customerName,
      customerPhone: r.customer?.phone ?? null,
      date: r.date,
    }));
    return { items, total };
  }

  async getDashboardExpiring(branchId?: string, skip?: number, take?: number) {
    const page = this.normalizePage(skip, take);
    const now = new Date();
    const ninetyDaysFromNow = dayjs().add(90, 'days').toDate();
    const where = {
      expiryDate: { lte: ninetyDaysFromNow, gte: now },
      quantity: { gt: 0 },
      ...(branchId ? { product: { branchId } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.batch.findMany({
        where,
        orderBy: { expiryDate: 'asc' },
        skip: page.skip,
        take: page.take,
        select: {
          id: true,
          batchNumber: true,
          expiryDate: true,
          quantity: true,
          product: { select: { name: true, packSize: true } },
        },
      }),
      this.prisma.batch.count({ where }),
    ]);
    return { items, total };
  }

  async getDashboardLowStock(branchId?: string, skip?: number, take?: number) {
    const page = this.normalizePage(skip, take);
    const { items, total } = await this.computeLowStock(branchId);
    return { items: items.slice(page.skip, page.skip + page.take), total };
  }

  async getDashboardOverdue(branchId?: string, skip?: number, take?: number) {
    const page = this.normalizePage(skip, take);
    const { all, total } = await this.computeOverdueCustomers(branchId);
    return { items: all.slice(page.skip, page.skip + page.take), total };
  }

  // ── Shared dashboard computations ──────────────────────────────
  // Canonical "low stock" definition — shared with /reports/inventory/stats
  // and consumed by the three KPI tiles (dashboard, products, stock overview).
  // A product is "low stock" iff it is active, currently has stock (totalStock
  // > 0), AND has dropped below its configured reorder level (totalStock <
  // minStock). Products with no stock are "out of stock" — a separate state
  // counted independently. Products with minStock = 0 (no reorder level set)
  // are not low-stock regardless of totalStock. Returns the FULL sorted list so
  // both the first page (getDashboardKpis) and lazy pages slice from one source.
  private async computeLowStock(branchId?: string) {
    const products = await this.prisma.product.findMany({
      where: { isActive: true, ...(branchId ? { branchId } : {}) },
      select: { id: true, name: true, packSize: true, totalStock: true, minStock: true, reorderQty: true },
    });
    const lowStock = products.filter((p) => p.totalStock > 0 && p.totalStock < p.minStock);
    const outOfStockCount = products.filter((p) => p.totalStock <= 0).length;
    const items = lowStock
      .map((p) => ({
        id: p.id,
        name: p.name,
        packSize: p.packSize,
        totalStock: p.totalStock,
        minStock: p.minStock,
        reorderQty: p.reorderQty,
        deficit: p.minStock - p.totalStock,
      }))
      .sort((a, b) => b.deficit - a.deficit);
    return { items, total: lowStock.length, outOfStockCount, totalProducts: products.length };
  }

  // Overdue payments (invoices > 30d old, still unpaid), rolled up per customer.
  // Returns the FULL sorted list (by overdue amount desc) plus the customer
  // count and total overdue amount, so the first page and lazy pages share one
  // computation.
  private async computeOverdueCustomers(branchId?: string) {
    const bFilter = this.branchFilter(branchId);
    const overdueCutoff = dayjs().subtract(30, 'day').toDate();
    const overdueInvoices = await this.prisma.invoice.findMany({
      where: {
        paymentMode: { in: ['CREDIT', 'SPLIT'] },
        status: { in: ['UNPAID', 'PARTIAL'] },
        date: { lte: overdueCutoff },
        ...bFilter,
      },
      select: { customerId: true, customerName: true, date: true, grandTotal: true, amountPaid: true },
      orderBy: { date: 'asc' },
    });

    const overdueByCustomer = new Map<string, {
      customerId: string;
      customerName: string;
      overdueAmount: number;
      oldestDate: Date;
      invoiceCount: number;
    }>();
    overdueInvoices.forEach((inv) => {
      const unpaid = Number(inv.grandTotal) - Number(inv.amountPaid);
      if (unpaid <= 0) return;
      const key = inv.customerId ?? inv.customerName;
      const cur = overdueByCustomer.get(key);
      if (cur) {
        cur.overdueAmount += unpaid;
        cur.invoiceCount += 1;
        if (inv.date < cur.oldestDate) cur.oldestDate = inv.date;
      } else {
        overdueByCustomer.set(key, {
          customerId: inv.customerId ?? '',
          customerName: inv.customerName,
          overdueAmount: unpaid,
          oldestDate: inv.date,
          invoiceCount: 1,
        });
      }
    });

    // Batch-fetch phones for the customer ids so the dashboard inbox can
    // render "name + phone" per row. Skip ids that came back empty
    // (rare — represents an invoice whose customerId is null).
    const idsForPhone = Array.from(overdueByCustomer.values())
      .map((c) => c.customerId)
      .filter(Boolean);
    const phoneMap = new Map<string, string>();
    if (idsForPhone.length) {
      const customers = await this.prisma.customer.findMany({
        where: { id: { in: idsForPhone } },
        select: { id: true, phone: true },
      });
      for (const c of customers) phoneMap.set(c.id, c.phone);
    }

    const all = Array.from(overdueByCustomer.values())
      .map((c) => ({
        customerId: c.customerId,
        customerName: c.customerName,
        customerPhone: c.customerId ? phoneMap.get(c.customerId) ?? null : null,
        overdueAmount: c.overdueAmount,
        daysOverdue: dayjs().diff(dayjs(c.oldestDate), 'day'),
        invoiceCount: c.invoiceCount,
      }))
      .sort((a, b) => b.overdueAmount - a.overdueAmount);

    const totalAmount = all.reduce((s, c) => s + c.overdueAmount, 0);
    return { all, total: overdueByCustomer.size, totalAmount };
  }

  // ── Flexible sales range (powers the dashboard hero chart) ─────
  async getSalesRange(query: { from: string; to: string; bucket: 'day' | 'month'; branchId?: string }) {
    const bFilter = this.branchFilter(query.branchId);
    const start = dayjs(query.from).startOf('day');
    const end = dayjs(query.to).endOf('day');

    const invoices = await this.prisma.invoice.findMany({
      where: { date: { gte: start.toDate(), lte: end.toDate() }, ...bFilter },
      select: { date: true, grandTotal: true },
    });

    const total = invoices.reduce((s, i) => s + Number(i.grandTotal), 0);
    const invoiceCount = invoices.length;

    if (query.bucket === 'day') {
      const numDays = end.startOf('day').diff(start.startOf('day'), 'day') + 1;
      const chartData = Array.from({ length: numDays }, (_, i) => {
        const day = start.add(i, 'day');
        return { label: day.format('DD MMM'), amount: 0, iso: day.format('YYYY-MM-DD') };
      });
      invoices.forEach((inv) => {
        const idx = dayjs(inv.date).startOf('day').diff(start.startOf('day'), 'day');
        if (idx >= 0 && idx < chartData.length) {
          chartData[idx].amount += Number(inv.grandTotal);
        }
      });
      return { bucket: 'day', chartData, total, invoiceCount };
    }

    // month buckets
    const monthsMap = new Map<string, { label: string; amount: number; iso: string }>();
    let cursor = start.startOf('month');
    while (cursor.isBefore(end) || cursor.isSame(end, 'month')) {
      const key = cursor.format('YYYY-MM');
      monthsMap.set(key, { label: cursor.format('MMM'), amount: 0, iso: key });
      cursor = cursor.add(1, 'month');
    }
    invoices.forEach((inv) => {
      const key = dayjs(inv.date).format('YYYY-MM');
      const entry = monthsMap.get(key);
      if (entry) entry.amount += Number(inv.grandTotal);
    });
    return { bucket: 'month', chartData: Array.from(monthsMap.values()), total, invoiceCount };
  }

  // ── Daily / Monthly / Yearly Sales ─────────────────────────────
  async getDailySales(branchId?: string) {
    const bFilter = this.branchFilter(branchId);
    const today = dayjs().startOf('day').toDate();
    const tomorrow = dayjs().add(1, 'day').startOf('day').toDate();

    const invoices = await this.prisma.invoice.findMany({
      where: { date: { gte: today, lt: tomorrow }, ...bFilter },
      orderBy: { date: 'asc' },
    });

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

    const creditNotesToday = await this.prisma.creditNote.aggregate({
      where: { date: { gte: today, lt: tomorrow }, ...bFilter },
      _sum: { totalAmount: true },
    });

    return {
      chartData,
      tableData,
      kpis: [
        { label: 'Total Sales', value: this.inr(totalSales) },
        { label: 'Invoices', value: invoices.length.toString() },
        { label: 'Avg. Invoice', value: this.inr(avgInvoice) },
        { label: 'Returns', value: this.inr(Number(creditNotesToday._sum.totalAmount ?? 0)) },
      ],
    };
  }

  async getMonthlySales(year?: string, branchId?: string) {
    const bFilter = this.branchFilter(branchId);
    const yr = year ? parseInt(year, 10) : dayjs().year();
    const start = dayjs(`${yr}-01-01`).startOf('year').toDate();
    const end = dayjs(`${yr}-12-31`).endOf('year').toDate();

    const invoices = await this.prisma.invoice.findMany({
      where: { date: { gte: start, lte: end }, ...bFilter },
      select: { date: true, grandTotal: true },
    });

    const chartData = Array.from({ length: 12 }, (_, i) => ({
      month: dayjs().month(i).format('MMM'),
      amount: 0,
      invoices: 0,
    }));

    invoices.forEach((inv) => {
      const m = dayjs(inv.date).month();
      chartData[m].amount += Number(inv.grandTotal);
      chartData[m].invoices += 1;
    });

    const total = chartData.reduce((s, c) => s + c.amount, 0);
    return {
      year: yr,
      chartData,
      kpis: [
        { label: 'Annual Revenue', value: this.inr(total) },
        { label: 'Total Invoices', value: invoices.length.toString() },
        { label: 'Avg. Monthly', value: this.inr(total / 12) },
      ],
    };
  }

  async getYearlySales(branchId?: string) {
    const bFilter = this.branchFilter(branchId);
    const invoices = await this.prisma.invoice.findMany({
      where: { ...bFilter },
      select: { date: true, grandTotal: true },
    });
    const byYear = new Map<number, { amount: number; invoices: number }>();
    invoices.forEach((inv) => {
      const y = dayjs(inv.date).year();
      const cur = byYear.get(y) || { amount: 0, invoices: 0 };
      cur.amount += Number(inv.grandTotal);
      cur.invoices += 1;
      byYear.set(y, cur);
    });
    const chartData = Array.from(byYear.entries())
      .map(([year, v]) => ({ year: String(year), amount: v.amount, invoices: v.invoices }))
      .sort((a, b) => Number(a.year) - Number(b.year));
    return { chartData };
  }

  // ── Product / Customer Sales ───────────────────────────────────
  async getProductSales(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);

    const items = await this.prisma.invoiceItem.findMany({
      where: { invoice: { date: { gte: from, lte: to }, ...bFilter } },
      include: { invoice: { select: { date: true } } },
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
      current.cost += Number(item.rate) * 0.7 * item.quantity;
      productStats.set(item.productId, current);
    });

    const chartData = Array.from(productStats.values())
      .map((ps) => ({
        product: ps.product,
        revenue: this.roundCurrency(ps.revenue),
        qtySold: ps.qtySold,
        margin: ps.revenue > 0
          ? this.roundCurrency(((ps.revenue - ps.cost) / ps.revenue) * 100)
          : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20);

    return {
      chartData,
      tableData: chartData,
      kpis: [
        { label: 'Products Sold', value: productStats.size.toString() },
        { label: 'Total Revenue', value: this.inr(chartData.reduce((s, c) => s + c.revenue, 0)) },
        {
          label: 'Avg. Margin',
          value:
            chartData.length > 0
              ? `${(chartData.reduce((s, c) => s + c.margin, 0) / chartData.length).toFixed(1)}%`
              : '0%',
        },
      ],
    };
  }

  async getCustomerSales(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);

    const invoices = await this.prisma.invoice.findMany({
      where: { date: { gte: from, lte: to }, ...bFilter },
      select: {
        customerId: true,
        customerName: true,
        grandTotal: true,
      },
    });

    const stats = new Map<string, { customer: string; invoices: number; revenue: number }>();
    invoices.forEach((inv) => {
      const key = inv.customerId || inv.customerName;
      const cur = stats.get(key) || { customer: inv.customerName, invoices: 0, revenue: 0 };
      cur.invoices += 1;
      cur.revenue += Number(inv.grandTotal);
      stats.set(key, cur);
    });

    const tableData = Array.from(stats.values()).sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = tableData.reduce((s, t) => s + t.revenue, 0);

    return {
      chartData: tableData.slice(0, 10),
      tableData,
      kpis: [
        { label: 'Total Customers', value: stats.size.toString() },
        { label: 'Total Revenue', value: this.inr(totalRevenue) },
        {
          label: 'Avg. Ticket',
          value: this.inr(invoices.length > 0 ? totalRevenue / invoices.length : 0),
        },
      ],
    };
  }

  // ── Stock Valuation / Movement / Aging / Expiry ─────────────────
  async getStockValuation(branchId?: string) {
    const batches = await this.prisma.batch.findMany({
      where: branchId ? { product: { branchId } } : undefined,
      include: { product: { include: { category: true } } },
    });
    const categoryValuation = new Map<string, number>();
    const tableData = batches.map((b) => {
      const cat = b.product.category?.name ?? 'Uncategorized';
      const purchaseValue = Number(b.purchaseRate) * b.quantity;
      categoryValuation.set(cat, (categoryValuation.get(cat) || 0) + purchaseValue);
      return {
        product: b.product.name,
        batch: b.batchNumber,
        qty: b.quantity,
        purchaseValue,
        mrpValue: Number(b.mrp) * b.quantity,
      };
    });
    const chartData = Array.from(categoryValuation.entries()).map(([category, value]) => ({ category, value }));
    const totalPurchaseValue = chartData.reduce((sum, c) => sum + c.value, 0);
    const totalMrpValue = tableData.reduce((sum, t) => sum + t.mrpValue, 0);

    return {
      chartData,
      tableData,
      kpis: [
        { label: 'Total Items', value: batches.length.toString() },
        { label: 'Purchase Value', value: this.inr(totalPurchaseValue) },
        { label: 'MRP Value', value: this.inr(totalMrpValue) },
        { label: 'Potential Margin', value: this.inr(totalMrpValue - totalPurchaseValue) },
      ],
    };
  }

  async getStockMovement(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);

    const grnItems = await this.prisma.gRNItem.findMany({
      where: { grn: { date: { gte: from, lte: to }, ...bFilter } },
      include: { grn: { select: { date: true } } },
    });
    const saleItems = await this.prisma.invoiceItem.findMany({
      where: { invoice: { date: { gte: from, lte: to }, ...bFilter } },
      include: { invoice: { select: { date: true } } },
    });
    const returnItems = await this.prisma.creditNoteItem.findMany({
      where: { creditNote: { date: { gte: from, lte: to }, ...bFilter } },
      include: { creditNote: { select: { date: true } } },
    });
    const debitItems = await this.prisma.purchaseReturnItem.findMany({
      where: { purchaseReturn: { date: { gte: from, lte: to }, ...bFilter } },
      include: { purchaseReturn: { select: { date: true } } },
    });

    const totals = {
      purchasesIn: grnItems.reduce((s, g) => s + g.receivedQty + g.freeQty - g.damageQty, 0),
      salesOut: saleItems.reduce((s, i) => s + i.quantity, 0),
      salesReturnIn: returnItems.reduce((s, r) => s + r.returnedQty, 0),
      purchaseReturnOut: debitItems.reduce((s, d) => s + d.returnedQty, 0),
    };

    const byProduct = new Map<string, { product: string; inQty: number; outQty: number }>();
    grnItems.forEach((g) => {
      const cur = byProduct.get(g.productId) || { product: g.productName, inQty: 0, outQty: 0 };
      cur.inQty += g.receivedQty + g.freeQty - g.damageQty;
      byProduct.set(g.productId, cur);
    });
    returnItems.forEach((r) => {
      const cur = byProduct.get(r.productId) || { product: r.productName, inQty: 0, outQty: 0 };
      cur.inQty += r.returnedQty;
      byProduct.set(r.productId, cur);
    });
    saleItems.forEach((i) => {
      const cur = byProduct.get(i.productId) || { product: i.productName, inQty: 0, outQty: 0 };
      cur.outQty += i.quantity;
      byProduct.set(i.productId, cur);
    });
    debitItems.forEach((d) => {
      const cur = byProduct.get(d.productId) || { product: d.productName, inQty: 0, outQty: 0 };
      cur.outQty += d.returnedQty;
      byProduct.set(d.productId, cur);
    });

    const tableData = Array.from(byProduct.values())
      .map((p) => ({ ...p, net: p.inQty - p.outQty }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

    return {
      tableData,
      kpis: [
        { label: 'Purchases In', value: totals.purchasesIn.toString() },
        { label: 'Sales Out', value: totals.salesOut.toString() },
        { label: 'Sales Returns', value: totals.salesReturnIn.toString() },
        { label: 'Purchase Returns', value: totals.purchaseReturnOut.toString() },
      ],
    };
  }

  async getStockAging(branchId?: string) {
    const today = dayjs();
    const batches = await this.prisma.batch.findMany({
      where: { quantity: { gt: 0 }, ...(branchId ? { product: { branchId } } : {}) },
      include: { product: true },
    });

    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '91-180': 0, '180+': 0 };
    const tableData = batches.map((b) => {
      const age = today.diff(dayjs(b.createdAt), 'day');
      let bucket: keyof typeof buckets = '0-30';
      if (age > 180) bucket = '180+';
      else if (age > 90) bucket = '91-180';
      else if (age > 60) bucket = '61-90';
      else if (age > 30) bucket = '31-60';
      const value = Number(b.purchaseRate) * b.quantity;
      buckets[bucket] += value;
      return {
        product: b.product.name,
        batch: b.batchNumber,
        qty: b.quantity,
        ageDays: age,
        bucket,
        value,
      };
    });

    const chartData = Object.entries(buckets).map(([bucket, value]) => ({ bucket, value }));
    return {
      chartData,
      tableData: tableData.sort((a, b) => b.ageDays - a.ageDays),
      kpis: [
        { label: 'Active Batches', value: batches.length.toString() },
        { label: 'Dead Stock (>180d)', value: this.inr(buckets['180+']) },
        { label: 'Fresh (<30d)', value: this.inr(buckets['0-30']) },
      ],
    };
  }

  // Lightweight inventory KPI bundle for the Stock Overview / Products /
  // Expiry summary cards. Returns just the counters — no row data — so it
  // stays cheap to call from any page. Also includes per-bucket expiry
  // counts/values (30 / 60 / 90 / 180 day windows + expired) so the Expiry
  // page's 5 summary cards can render in a single round-trip.
  async getInventoryStats(branchId?: string) {
    const now = new Date();
    const oneEightyDays = dayjs().add(180, 'days').toDate();
    const branchProductFilter = branchId ? { product: { branchId } } : {};
    const productBranchFilter = branchId ? { branchId } : {};

    const [stockBucket, categoriesCount, activeBatches, expiredBatchesRaw, near180Batches] = await Promise.all([
      this.prisma.product.findMany({
        where: { ...productBranchFilter, isActive: true },
        select: { totalStock: true, minStock: true },
      }),
      this.prisma.category.count({ where: branchId ? { OR: [{ branchId }, { branchId: null }] } : undefined }),
      this.prisma.batch.findMany({
        where: { ...branchProductFilter, expiryDate: { gte: now } },
        select: { quantity: true, mrp: true },
      }),
      this.prisma.batch.findMany({
        where: { ...branchProductFilter, expiryDate: { lt: now }, quantity: { gt: 0 } },
        select: { quantity: true, mrp: true },
      }),
      // All batches expiring within 180 days (inclusive). We bucket these in
      // memory rather than firing four separate queries.
      this.prisma.batch.findMany({
        where: {
          ...branchProductFilter,
          expiryDate: { gte: now, lte: oneEightyDays },
          quantity: { gt: 0 },
        },
        select: { quantity: true, mrp: true, expiryDate: true },
      }),
    ]);

    const totalProducts = stockBucket.length;
    const outOfStockItems = stockBucket.filter((p) => p.totalStock === 0).length;
    // Same canonical "low stock" rule used by getDashboardKpis — see comment
    // there. Both endpoints must filter identically so the Dashboard, Products,
    // and Stock Overview KPI tiles never drift apart.
    const lowStockItems = stockBucket.filter((p) => p.totalStock > 0 && p.totalStock < p.minStock).length;
    const sellableStockValue = activeBatches.reduce((s, b) => s + b.quantity * Number(b.mrp), 0);
    const expiredStockValue = expiredBatchesRaw.reduce((s, b) => s + b.quantity * Number(b.mrp), 0);

    // Bucket near-expiry batches into 30/60/90/180 day windows (cumulative).
    const buckets = { '30d': { count: 0, value: 0 }, '60d': { count: 0, value: 0 }, '90d': { count: 0, value: 0 }, '180d': { count: 0, value: 0 } };
    for (const b of near180Batches) {
      const days = Math.floor((new Date(b.expiryDate).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      const value = b.quantity * Number(b.mrp);
      const slot = days <= 30 ? '30d' : days <= 60 ? '60d' : days <= 90 ? '90d' : '180d';
      buckets[slot].count += 1;
      buckets[slot].value += value;
    }

    return {
      totalProducts,
      lowStockItems,
      outOfStockItems,
      categoriesCount,
      sellableStockValue,
      nearExpiryCount: buckets['30d'].count + buckets['60d'].count + buckets['90d'].count,
      expiredStockValue,
      expiredBatchCount: expiredBatchesRaw.length,
      expiryBuckets: {
        expired: { count: expiredBatchesRaw.length, value: expiredStockValue },
        ...buckets,
      },
    };
  }

  async getExpiryReport(branchId?: string) {
    const today = new Date();
    const ninetyDays = dayjs().add(90, 'days').toDate();
    const batchBranchFilter = branchId ? { product: { branchId } } : {};

    const expired = await this.prisma.batch.findMany({
      where: { expiryDate: { lt: today }, quantity: { gt: 0 }, ...batchBranchFilter },
      include: { product: true, supplier: { select: { name: true } } },
      orderBy: { expiryDate: 'asc' },
    });
    const nearExpiry = await this.prisma.batch.findMany({
      where: { expiryDate: { gte: today, lte: ninetyDays }, quantity: { gt: 0 }, ...batchBranchFilter },
      include: { product: true, supplier: { select: { name: true } } },
      orderBy: { expiryDate: 'asc' },
    });

    const mapBatch = (b: any, status: 'EXPIRED' | 'NEAR_EXPIRY') => ({
      product: b.product.name,
      batch: b.batchNumber,
      expiryDate: b.expiryDate,
      qty: b.quantity,
      mrpValue: Number(b.mrp) * b.quantity,
      purchaseValue: Number(b.purchaseRate) * b.quantity,
      supplier: b.supplier?.name,
      daysToExpiry: dayjs(b.expiryDate).diff(dayjs(), 'day'),
      status,
    });

    const tableData = [
      ...expired.map((b) => mapBatch(b, 'EXPIRED')),
      ...nearExpiry.map((b) => mapBatch(b, 'NEAR_EXPIRY')),
    ];

    const expiredValue = expired.reduce((s, b) => s + Number(b.purchaseRate) * b.quantity, 0);
    const nearValue = nearExpiry.reduce((s, b) => s + Number(b.purchaseRate) * b.quantity, 0);

    return {
      tableData,
      kpis: [
        { label: 'Expired Batches', value: expired.length.toString() },
        { label: 'Expired Value', value: this.inr(expiredValue) },
        { label: 'Near Expiry (90d)', value: nearExpiry.length.toString() },
        { label: 'Near Expiry Value', value: this.inr(nearValue) },
      ],
    };
  }

  // ── Profit & Loss ──────────────────────────────────────────────
  async getProfitLoss(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);

    // Only INVOICE-type rows that actually represent finalised sales count
    // toward revenue. Exclude DRAFT (pharmacist's pending credit drafts not
    // yet approved), CANCELLED (voided), and QUOTATION (non-binding).
    const invoiceWhere = {
      date: { gte: from, lte: to },
      type: 'INVOICE' as const,
      status: { notIn: ['DRAFT', 'CANCELLED'] as any[] },
      ...bFilter,
    };
    const invoices = await this.prisma.invoice.findMany({
      where: invoiceWhere,
      include: { items: true },
    });
    // Fetch every referenced batch in one query so COGS can use real
    // purchase rates without an N+1. InvoiceItem stores batchId without a
    // declared Prisma relation, so we resolve it ourselves.
    const batchIds = Array.from(
      new Set(
        invoices.flatMap((inv) => inv.items.map((it) => it.batchId).filter(Boolean)),
      ),
    );
    const batches = batchIds.length
      ? await this.prisma.batch.findMany({
          where: { id: { in: batchIds } },
          select: { id: true, purchaseRate: true },
        })
      : [];
    const purchaseRateByBatchId = new Map(
      batches.map((b) => [b.id, Number(b.purchaseRate ?? 0)]),
    );
    // Sales returns reduce revenue only when the return is real AND actually
    // reverses the sale: APPROVED + settled as Refund or Credit. PENDING/REJECTED
    // aren't financial events, and REPLACEMENT is goods-for-goods (no revenue
    // reduction). Mirrors the credit-note filter in getCustomerLedger.
    const creditNotes = await this.prisma.creditNote.aggregate({
      where: {
        date: { gte: from, lte: to },
        status: 'APPROVED',
        settlementMode: { in: ['CREDIT', 'REFUND'] },
        ...bFilter,
      },
      _sum: { totalAmount: true },
    });
    const purchases = await this.prisma.gRN.aggregate({
      where: { date: { gte: from, lte: to }, ...bFilter },
      _sum: { totalAmount: true },
    });
    const purchaseReturns = await this.prisma.purchaseReturn.aggregate({
      where: { date: { gte: from, lte: to }, ...bFilter },
      _sum: { totalAmount: true },
    });
    const expenses = await this.prisma.expense.aggregate({
      where: { date: { gte: from, lte: to }, ...bFilter },
      _sum: { amount: true },
    });

    const grossSales = invoices.reduce((s, inv) => s + Number(inv.grandTotal), 0);
    const totalTax = invoices.reduce(
      (s, inv) => s + Number(inv.cgst) + Number(inv.sgst) + Number(inv.igst),
      0,
    );
    const salesReturn = Number(creditNotes._sum.totalAmount ?? 0);
    const netSales = grossSales - salesReturn;
    // COGS uses each batch's actual purchase rate. If the batch row was
    // deleted (shouldn't happen — FK constraints), the line contributes 0 —
    // better to under-report cost than fabricate it from a markup assumption.
    const costOfGoods = invoices.reduce(
      (s, inv) =>
        s +
        inv.items.reduce((si, it) => {
          const cost = purchaseRateByBatchId.get(it.batchId) ?? 0;
          return si + cost * Number(it.quantity);
        }, 0),
      0,
    );
    const grossPurchases = Number(purchases._sum.totalAmount ?? 0);
    const purchaseReturn = Number(purchaseReturns._sum.totalAmount ?? 0);
    const opex = Number(expenses._sum.amount ?? 0);

    const grossProfit = netSales - costOfGoods;
    const netProfit = grossProfit - opex;

    return {
      period: { from, to },
      lineItems: [
        { label: 'Gross Sales', amount: grossSales },
        { label: 'Sales Returns', amount: -salesReturn },
        { label: 'Net Sales', amount: netSales, emphasis: true },
        { label: 'Cost of Goods Sold', amount: -costOfGoods },
        { label: 'Gross Profit', amount: grossProfit, emphasis: true },
        { label: 'Operating Expenses', amount: -opex },
        { label: 'Net Profit', amount: netProfit, emphasis: true },
      ],
      kpis: [
        { label: 'Net Sales', value: this.inr(netSales) },
        { label: 'Gross Profit', value: this.inr(grossProfit) },
        { label: 'Net Profit', value: this.inr(netProfit) },
        {
          label: 'Margin',
          value: netSales > 0 ? `${((netProfit / netSales) * 100).toFixed(1)}%` : '0%',
        },
      ],
      extras: { grossPurchases, purchaseReturn, totalTax },
    };
  }

  // Monthly P&L for a year — drives the trend chart on the FE so it shows
  // real profit per month instead of a fake 20% derivation. Each month
  // delegates to getProfitLoss so the calculation stays canonical.
  async getMonthlyProfitLoss(year?: number, branchId?: string) {
    const targetYear = year ?? new Date().getFullYear();
    const months = Array.from({ length: 12 }, (_, i) => i);
    const results = await Promise.all(
      months.map(async (m) => {
        const from = new Date(targetYear, m, 1).toISOString().slice(0, 10);
        const to = new Date(targetYear, m + 1, 0).toISOString().slice(0, 10);
        const pl = await this.getProfitLoss({ from, to, branchId });
        const find = (label: string) =>
          Number(pl.lineItems.find((li) => li.label === label)?.amount ?? 0);
        return {
          month: new Date(targetYear, m, 1).toLocaleString('en-IN', { month: 'short' }),
          revenue: find('Net Sales'),
          profit: find('Net Profit'),
        };
      }),
    );
    return { year: targetYear, chartData: results };
  }

  // ── GST Reports ────────────────────────────────────────────────
  async getGstr1Summary(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);
    const invoices = await this.prisma.invoice.findMany({
      where: { date: { gte: from, lte: to }, type: 'INVOICE', ...bFilter },
      include: { items: true },
    });
    const creditNotes = await this.prisma.creditNote.findMany({
      where: { date: { gte: from, lte: to }, ...bFilter },
    });

    const bySlab = new Map<string, { gstRate: number; taxable: number; cgst: number; sgst: number; igst: number }>();
    invoices.forEach((inv) => {
      inv.items.forEach((it) => {
        const slab = Number(it.gstPercent);
        const key = String(slab);
        const taxable = Number(it.amount) / (1 + slab / 100);
        const cur = bySlab.get(key) || { gstRate: slab, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        cur.taxable += taxable;
        cur.cgst += (taxable * slab) / 200;
        cur.sgst += (taxable * slab) / 200;
        bySlab.set(key, cur);
      });
    });

    const rawTable = Array.from(bySlab.values()).sort((a, b) => a.gstRate - b.gstRate);
    const tableData = rawTable.map((r) => ({
      gstRate: r.gstRate,
      taxable: this.roundCurrency(r.taxable),
      cgst: this.roundCurrency(r.cgst),
      sgst: this.roundCurrency(r.sgst),
      igst: this.roundCurrency(r.igst),
    }));
    const totals = tableData.reduce(
      (s, t) => ({
        taxable: this.roundCurrency(s.taxable + t.taxable),
        cgst: this.roundCurrency(s.cgst + t.cgst),
        sgst: this.roundCurrency(s.sgst + t.sgst),
        igst: this.roundCurrency(s.igst + t.igst),
      }),
      { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
    );

    const creditNoteTotal = this.roundCurrency(
      creditNotes.reduce((s, c) => s + Number(c.totalAmount), 0),
    );

    return {
      period: { from, to },
      tableData,
      totals,
      kpis: [
        { label: 'Taxable Value', value: this.inr(totals.taxable) },
        { label: 'Total Tax', value: this.inr(totals.cgst + totals.sgst + totals.igst) },
        { label: 'Invoices', value: invoices.length.toString() },
        { label: 'Credit Notes', value: this.inr(creditNoteTotal) },
      ],
    };
  }

  async getGstr3bSummary(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);
    const outward = await this.prisma.invoice.aggregate({
      where: { date: { gte: from, lte: to }, type: 'INVOICE', ...bFilter },
      _sum: { taxableAmount: true, cgst: true, sgst: true, igst: true },
    });
    const inward = await this.prisma.gRN.aggregate({
      where: { date: { gte: from, lte: to }, ...bFilter },
      _sum: { totalAmount: true },
    });

    const cgst = this.roundCurrency(Number(outward._sum.cgst ?? 0));
    const sgst = this.roundCurrency(Number(outward._sum.sgst ?? 0));
    const igst = this.roundCurrency(Number(outward._sum.igst ?? 0));
    const outwardTaxable = this.roundCurrency(Number(outward._sum.taxableAmount ?? 0));
    const inwardTotal = this.roundCurrency(Number(inward._sum.totalAmount ?? 0));

    return {
      period: { from, to },
      outwardSupplies: {
        taxableValue: outwardTaxable,
        cgst,
        sgst,
        igst,
        totalTax: this.roundCurrency(cgst + sgst + igst),
      },
      inwardSupplies: {
        totalValue: inwardTotal,
      },
      kpis: [
        { label: 'Outward Taxable', value: this.inr(outwardTaxable) },
        { label: 'Tax Payable', value: this.inr(cgst + sgst + igst) },
        { label: 'Inward Supplies', value: this.inr(inwardTotal) },
      ],
    };
  }

  async getHsnSummary(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);
    const items = await this.prisma.invoiceItem.findMany({
      where: { invoice: { date: { gte: from, lte: to }, type: 'INVOICE', ...bFilter } },
    });
    const products = await this.prisma.product.findMany({
      select: { id: true, hsnCode: true, unitOfMeasure: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const byHsn = new Map<string, { hsn: string; uqc: string; qty: number; taxable: number; gstRate: number; tax: number }>();
    items.forEach((it) => {
      const p = productMap.get(it.productId);
      const hsn = p?.hsnCode || 'UNSPECIFIED';
      const slab = Number(it.gstPercent);
      const taxable = Number(it.amount) / (1 + slab / 100);
      const tax = Number(it.amount) - taxable;
      const cur = byHsn.get(hsn) || { hsn, uqc: p?.unitOfMeasure || 'NOS', qty: 0, taxable: 0, gstRate: slab, tax: 0 };
      cur.qty += it.quantity;
      cur.taxable += taxable;
      cur.tax += tax;
      byHsn.set(hsn, cur);
    });

    const rawHsnTable = Array.from(byHsn.values()).sort((a, b) => b.taxable - a.taxable);
    const tableData = rawHsnTable.map((r) => ({
      hsn: r.hsn,
      uqc: r.uqc,
      qty: r.qty,
      gstRate: r.gstRate,
      taxable: this.roundCurrency(r.taxable),
      tax: this.roundCurrency(r.tax),
    }));
    const totals = tableData.reduce(
      (s, t) => ({
        taxable: this.roundCurrency(s.taxable + t.taxable),
        tax: this.roundCurrency(s.tax + t.tax),
        qty: s.qty + t.qty,
      }),
      { taxable: 0, tax: 0, qty: 0 },
    );

    return {
      period: { from, to },
      tableData,
      totals,
      kpis: [
        { label: 'HSN Codes', value: tableData.length.toString() },
        { label: 'Taxable', value: this.inr(totals.taxable) },
        { label: 'Tax', value: this.inr(totals.tax) },
      ],
    };
  }

  // ── Cash Book ──────────────────────────────────────────────────
  async getCashBook(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);

    type CashRow = {
      date: Date;
      ref: string;
      description: string;
      amount: number;
      type: 'RECEIPT' | 'PAYMENT';
      receiptImage?: string | null;
    };

    // ── Cash IN ────────────────────────────────────────────────────────────
    // At-sale cash is written straight to invoice.amountPaid (no Payment row),
    // so the invoice IS the source for that portion — dated correctly on the
    // sale day. Cash collected LATER comes in as Payment rows; we must date
    // those by when the cash actually arrived (payment.createdAt), not the
    // invoice date. So: at-sale base = amountPaid − Σ(this invoice's payments),
    // dated by inv.date; then every CASH Payment row re-added on its own date.
    const cashInvoices = await this.prisma.invoice.findMany({
      where: {
        date: { gte: from, lte: to },
        paymentMode: { in: ['CASH', 'SPLIT'] },
        ...bFilter,
      },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, invoiceNumber: true, customerName: true, amountPaid: true },
    });
    const cashInvoiceIds = cashInvoices.map((i) => i.id);
    const paidByInvoiceAgg = cashInvoiceIds.length
      ? await this.prisma.payment.groupBy({
          by: ['invoiceId'],
          where: { invoiceId: { in: cashInvoiceIds } },
          _sum: { amount: true },
        })
      : [];
    const paidByInvoice = new Map(
      paidByInvoiceAgg.map((p) => [p.invoiceId, Number(p._sum.amount ?? 0)]),
    );
    const atSaleReceipts: CashRow[] = cashInvoices
      .map((inv): CashRow | null => {
        const base = Number(inv.amountPaid) - (paidByInvoice.get(inv.id) ?? 0);
        return base > 0.01
          ? {
              date: inv.date,
              ref: inv.invoiceNumber,
              description: `Sale to ${inv.customerName}`,
              amount: base,
              type: 'RECEIPT',
            }
          : null;
      })
      .filter((r): r is CashRow => r !== null);

    // Every CASH payment in the window (incl. customer-level lump payments with
    // no invoiceId), dated by when the money came in.
    const cashPayments = await this.prisma.payment.findMany({
      where: {
        paymentMode: { equals: 'CASH', mode: 'insensitive' },
        createdAt: { gte: from, lte: to },
        ...bFilter,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        invoice: { select: { invoiceNumber: true, customerName: true } },
        customer: { select: { name: true } },
      },
    });
    const paymentReceipts: CashRow[] = cashPayments.map((p) => ({
      date: p.createdAt,
      ref: p.invoice?.invoiceNumber ?? p.receiptNumber,
      description: `Payment from ${p.invoice?.customerName ?? p.customer?.name ?? 'customer'}`,
      amount: Number(p.amount),
      type: 'RECEIPT',
    }));

    // ── Cash OUT ───────────────────────────────────────────────────────────
    // Case-insensitive cash match. New writes are normalised UPPERCASE in
    // ExpensesService; the `mode: 'insensitive'` covers legacy rows stored as
    // 'Cash' / 'cash' before the normalization landed.
    const cashExpenses = await this.prisma.expense.findMany({
      where: {
        date: { gte: from, lte: to },
        paymentMode: { equals: 'CASH', mode: 'insensitive' },
        ...bFilter,
      },
      orderBy: { date: 'asc' },
    });
    const expensePayments: CashRow[] = cashExpenses.map((e) => ({
      date: e.date,
      ref: e.id.slice(0, 8),
      description: `${e.category}: ${e.description}`,
      amount: Number(e.amount),
      type: 'PAYMENT',
      receiptImage: e.receiptImage,
    }));

    // NOTE: customer refunds are intentionally NOT shown here. The payout method
    // (cash vs UPI/card) isn't known at approval, so we don't assume it hit the
    // cash drawer. If a refund was paid in cash, the user records it manually as
    // a cash Expense. Refunds still post to the customer ledger and P&L.

    const receipts = [...atSaleReceipts, ...paymentReceipts];
    const payments = expensePayments;

    const totalReceipts = receipts.reduce((s, r) => s + r.amount, 0);
    const totalPayments = payments.reduce((s, p) => s + p.amount, 0);

    const entries = [...receipts, ...payments].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    // Opening balance = all cash IN minus all cash OUT BEFORE the requested
    // period, using the SAME sources as above so opening + period = true
    // closing. Prior at-sale base = Σ(amountPaid) − Σ(payments) of CASH/SPLIT
    // invoices dated before `from`; prior cash payments/expenses by date.
    const [priorInvAmt, priorInvPayments, priorCashPay, priorCashExp] =
      await Promise.all([
        this.prisma.invoice.aggregate({
          where: { date: { lt: from }, paymentMode: { in: ['CASH', 'SPLIT'] }, ...bFilter },
          _sum: { amountPaid: true },
        }),
        this.prisma.payment.aggregate({
          where: { invoice: { date: { lt: from }, paymentMode: { in: ['CASH', 'SPLIT'] } }, ...bFilter },
          _sum: { amount: true },
        }),
        this.prisma.payment.aggregate({
          where: { paymentMode: { equals: 'CASH', mode: 'insensitive' }, createdAt: { lt: from }, ...bFilter },
          _sum: { amount: true },
        }),
        this.prisma.expense.aggregate({
          where: { date: { lt: from }, paymentMode: { equals: 'CASH', mode: 'insensitive' }, ...bFilter },
          _sum: { amount: true },
        }),
      ]);
    const priorBase =
      Number(priorInvAmt._sum.amountPaid ?? 0) - Number(priorInvPayments._sum.amount ?? 0);
    const openingBalance =
      priorBase +
      Number(priorCashPay._sum.amount ?? 0) -
      Number(priorCashExp._sum.amount ?? 0);

    let running = openingBalance;
    const ledger = entries.map((e) => {
      running += e.type === 'RECEIPT' ? e.amount : -e.amount;
      return { ...e, balance: running };
    });

    const closingBalance = openingBalance + totalReceipts - totalPayments;

    return {
      period: { from, to },
      openingBalance,
      closingBalance,
      tableData: ledger,
      kpis: [
        { label: 'Opening Balance', value: this.inr(openingBalance) },
        { label: 'Total Receipts', value: this.inr(totalReceipts) },
        { label: 'Total Payments', value: this.inr(totalPayments) },
        { label: 'Closing Balance', value: this.inr(closingBalance) },
      ],
    };
  }

  // ── Customer Ledger ────────────────────────────────────────────
  async getCustomerLedger(
    customerId: string,
    query: PeriodQuery & { branchId?: string; skip?: number; take?: number },
  ) {
    // Custom period handling — `resolvePeriod()` defaults `from` to
    // start-of-current-month when none is supplied, which silently truncates
    // "All Time" requests. The detail-page Ledger tab needs true full-history,
    // so we build the date predicate manually: omit it entirely when from/to
    // are both unset.
    const fromDate = query.from ? dayjs(query.from).startOf('day').toDate() : undefined;
    const toDate = query.to ? dayjs(query.to).endOf('day').toDate() : undefined;
    const dateFilter: { gte?: Date; lte?: Date } | undefined =
      fromDate || toDate
        ? { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) }
        : undefined;
    const bFilter = this.branchFilter(query.branchId);

    // Reject the lookup if the customer belongs to a different branch — keeps
    // a BR1 accountant from probing HQ customer ids directly.
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return { customer: null, tableData: [], kpis: [] };
    if (query.branchId && customer.branchId && customer.branchId !== query.branchId) {
      return { customer: null, tableData: [], kpis: [] };
    }

    const invoices = await this.prisma.invoice.findMany({
      // Exclude DRAFT (never posted) and CANCELLED (wound down) invoices so
      // they don't appear as billed ledger rows or inflate the "Total Sales"
      // KPI. Mirrors the customer list/summary aggregates (CustomersService).
      where: {
        customerId,
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        ...(dateFilter ? { date: dateFilter } : {}),
        ...bFilter,
      },
      orderBy: { date: 'asc' },
      select: {
        id: true,
        date: true,
        invoiceNumber: true,
        grandTotal: true,
        amountPaid: true,
        paymentMode: true,
      },
    });
    // Real payment timestamps come from the Payment table, not inv.amountPaid —
    // a customer can pay weeks after the invoice, and the ledger needs to date
    // the receipt on the day cash actually came in. Payments are filtered on
    // their own createdAt so the ledger reflects what moved within the
    // requested period rather than what was billed in it.
    const payments = await this.prisma.payment.findMany({
      where: {
        customerId,
        ...(dateFilter ? { createdAt: dateFilter } : {}),
        ...bFilter,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        receiptNumber: true,
        createdAt: true,
        amount: true,
        paymentMode: true,
        invoiceId: true,
        invoice: { select: { invoiceNumber: true } },
      },
    });
    // Reconciliation: some historical invoices (notably seeded data, and any
    // invoice created before the Payment table existed in this system) have a
    // non-zero `amountPaid` but no corresponding Payment row. Without
    // bridging those, the ledger's running balance would be inflated by the
    // missing credits and stop matching customer.currentOutstanding. We sum
    // real Payments per invoice and synthesise a "legacy payment" entry on
    // the invoice date for whatever amountPaid the real Payments don't cover.
    // The synthetic entry uses the invoice date because we don't know the
    // real receipt date — it's the best approximation that keeps math right.
    const realPaidByInvoice = new Map<string, number>();
    for (const p of payments) {
      if (!p.invoiceId) continue;
      realPaidByInvoice.set(p.invoiceId, (realPaidByInvoice.get(p.invoiceId) ?? 0) + Number(p.amount));
    }
    // All APPROVED credit notes appear in the ledger, but only CREDIT-settlement
    // ("Adjust Against Outstanding") returns MOVE the running balance — they
    // genuinely reduce what the customer owes. REFUND-settled returns (goods came
    // back AND cash went back) and REPLACEMENT returns (goods-for-goods) are
    // money-neutral to the customer's account: they're shown for visibility but
    // flagged `neutral` so they do NOT move the balance/outstanding. The ledger
    // therefore still stays in lockstep with customer.currentOutstanding.
    // Pending/rejected aren't financial events, so they stay out.
    const creditNotes = await this.prisma.creditNote.findMany({
      where: {
        customerId,
        status: 'APPROVED',
        ...(dateFilter ? { date: dateFilter } : {}),
        ...bFilter,
      },
      orderBy: { date: 'asc' },
    });
    // Total Returns is a customer-facing stat ("how much have they ever
    // returned"). Pending counts toward the staff inbox; rejected returns
    // were not real returns. Settlement mode is irrelevant — the goods came
    // back either way.
    const approvedReturnsForStats = await this.prisma.creditNote.findMany({
      where: {
        customerId,
        status: 'APPROVED',
        ...(dateFilter ? { date: dateFilter } : {}),
        ...bFilter,
      },
      select: { totalAmount: true },
    });

    // Cash/bank refunds paid out to the customer (from Refund-mode returns AND
    // the excess of an over-value Adjust-Against-Outstanding return). Shown in
    // the ledger for visibility; money-neutral to what the customer owes, so
    // they don't move the running balance.
    const refunds = await this.prisma.refund.findMany({
      where: {
        customerId,
        ...(dateFilter ? { createdAt: dateFilter } : {}),
        ...bFilter,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        refundNumber: true,
        createdAt: true,
        amount: true,
        paymentMode: true,
      },
    });

    // A CREDIT-settled ("Adjust Against Outstanding") credit note reduces the
    // customer's balance via its own ledger row AND, at approve-time, bumps the
    // absorbing invoices' `amountPaid`. The legacy-payment bridge below
    // synthesises a payment from any `amountPaid` not backed by a real Payment
    // row — which would re-count that same credit as a phantom "Payment (CREDIT)"
    // line, double-subtracting it from the running balance. Reconstruct how much
    // of each invoice's `amountPaid` came from credit notes (mirroring the
    // approve-time allocation: source invoice first, then FIFO by date, capped at
    // each invoice's pre-credit room) so the bridge can exclude it.
    const creditAbsorbedByInvoice = new Map<string, number>();
    {
      const capacity = new Map<string, number>();
      for (const inv of invoices) {
        capacity.set(
          inv.id,
          Math.max(0, Number(inv.grandTotal) - (realPaidByInvoice.get(inv.id) ?? 0)),
        );
      }
      const creditCNs = creditNotes
        .filter((c) => c.settlementMode === 'CREDIT')
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      for (const cn of creditCNs) {
        let remaining = Number(cn.totalAmount);
        const absorb = (invId: string) => {
          if (remaining <= 0.01) return;
          const room = capacity.get(invId) ?? 0;
          if (room <= 0.01) return;
          const apply = Math.min(remaining, room);
          capacity.set(invId, room - apply);
          creditAbsorbedByInvoice.set(
            invId,
            (creditAbsorbedByInvoice.get(invId) ?? 0) + apply,
          );
          remaining -= apply;
        };
        // 1. Source invoice first (matches CreditNotesService allocation order).
        if (cn.invoiceId && capacity.has(cn.invoiceId)) absorb(cn.invoiceId);
        // 2. Cascade leftover FIFO to the customer's other invoices (oldest
        //    first — `invoices` is already date-ascending).
        if (remaining > 0.01) {
          for (const inv of invoices) {
            if (remaining <= 0.01) break;
            if (inv.id === cn.invoiceId) continue;
            absorb(inv.id);
          }
        }
        // Anything still remaining was refunded (excess return) — it never
        // touched an invoice's amountPaid and doesn't move the balance.
      }
    }

    const entries: Array<{ date: Date; ref: string; description: string; debit: number; credit: number; neutral?: boolean; sourceType: 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE' | 'REFUND'; sourceId: string }> = [];

    invoices.forEach((inv) => {
      entries.push({
        date: inv.date,
        ref: inv.invoiceNumber,
        description: `Invoice`,
        debit: Number(inv.grandTotal),
        credit: 0,
        sourceType: 'INVOICE',
        sourceId: inv.id,
      });
      // Bridge invoices whose amountPaid wasn't captured as a Payment row —
      // but exclude the slice that came from CREDIT credit notes (the CN row
      // already moves the balance; counting it here too would double-subtract).
      const amountPaid = Number(inv.amountPaid);
      const realPaid = realPaidByInvoice.get(inv.id) ?? 0;
      const creditAbsorbed = creditAbsorbedByInvoice.get(inv.id) ?? 0;
      const legacyGap = amountPaid - realPaid - creditAbsorbed;
      if (legacyGap > 0.01) {
        entries.push({
          date: inv.date,
          ref: inv.invoiceNumber,
          description: `Payment (${inv.paymentMode ?? 'legacy'})`,
          debit: 0,
          credit: legacyGap,
          sourceType: 'PAYMENT',
          sourceId: `legacy-${inv.id}`,
        });
      }
    });

    payments.forEach((p) => {
      entries.push({
        date: p.createdAt,
        ref: p.invoice?.invoiceNumber ?? p.receiptNumber,
        description: `Payment (${p.paymentMode})`,
        debit: 0,
        credit: Number(p.amount),
        sourceType: 'PAYMENT',
        sourceId: p.id,
      });
    });

    creditNotes.forEach((cn) => {
      // Only CREDIT-settlement returns move the balance — by their FULL value.
      // An over-value Adjust takes the customer into advance (negative balance);
      // its excess refund (below) then brings them back to zero, so every row's
      // displayed amount matches the balance shift it causes. A REFUND-mode
      // return likewise moves the balance by its full value (the customer is in
      // advance until the cash refund below clears it) so the credit note's
      // impact is visible in the Balance column. Only REPLACEMENT stays neutral
      // — it's settled by a future replacement invoice, not cash, so it must not
      // drift the balance away from currentOutstanding in the meantime.
      const neutral = cn.settlementMode === 'REPLACEMENT';
      const tag =
        cn.settlementMode === 'REFUND' ? ' (Refund)'
        : cn.settlementMode === 'REPLACEMENT' ? ' (Replacement)'
        : '';
      entries.push({
        date: cn.date,
        ref: cn.creditNoteNo,
        description: `Credit Note${tag}: ${cn.reason}`,
        debit: 0,
        credit: Number(cn.totalAmount),
        neutral,
        sourceType: 'CREDIT_NOTE',
        sourceId: cn.id,
      });
    });

    refunds.forEach((r) => {
      // Cash paid back to the customer (a debit). It clears the advance the
      // matching credit note created — whether that was an over-value Adjust
      // (excess refunded) or a Refund-mode return (full amount refunded) — so it
      // always moves the balance from advance back toward zero.
      entries.push({
        date: r.createdAt,
        ref: r.refundNumber,
        description: `Refund (${r.paymentMode})`,
        debit: Number(r.amount),
        credit: 0,
        sourceType: 'REFUND',
        sourceId: r.id,
      });
    });

    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let balance = 0;
    const ledger = entries.map((e) => {
      // Neutral rows (refund/replacement returns, refund-mode payouts) display
      // their amount but do not move the running balance.
      if (!e.neutral) balance += e.debit - e.credit;
      return { ...e, balance };
    });

    // KPI totals exclude neutral rows so Closing Balance reconciles with
    // Opening + Debit − Credit. Total Debit/Credit are accounting figures (they
    // include refund debits); "Total Sales" is the business metric — only what
    // was actually invoiced — so it must exclude refund debits.
    const totalDebit = entries.reduce((s, e) => s + (e.neutral ? 0 : e.debit), 0);
    const totalCredit = entries.reduce((s, e) => s + (e.neutral ? 0 : e.credit), 0);
    const totalSales = entries.reduce(
      (s, e) => s + (e.sourceType === 'INVOICE' ? e.debit : 0),
      0,
    );
    const totalReturns = approvedReturnsForStats.reduce((s, cn) => s + Number(cn.totalAmount), 0);

    // Active Quotations is a current snapshot, not a period stat — must not be
    // date-filtered. Mirrors the Open POs fix on the supplier ledger.
    const activeQuotationsCount = await this.prisma.quotation.count({
      where: {
        customerId,
        ...bFilter,
        status: { in: ['DRAFT', 'SENT'] },
      },
    });

    // Pagination: the running balance + KPIs are computed over the FULL period
    // above, then we return only the requested page of rows. Each page row
    // already carries its correct cumulative balance, so page 2 continues
    // contiguously from page 1. KPIs stay whole-period regardless of page.
    const total = ledger.length;
    const paginated = typeof query.skip === 'number' && typeof query.take === 'number';
    const tableData = paginated
      ? ledger.slice(
          Math.max(query.skip!, 0),
          Math.max(query.skip!, 0) + Math.min(Math.max(query.take!, 1), 100),
        )
      : ledger;

    return {
      customer,
      tableData,
      total,
      kpis: [
        { label: 'Total Debit', value: this.inr(totalDebit) },
        { label: 'Total Credit', value: this.inr(totalCredit) },
        { label: 'Closing Balance', value: this.inr(balance) },
        { label: 'Outstanding', value: this.inr(Number(customer.currentOutstanding)) },
        { label: 'Total Sales', value: this.inr(totalSales) },
        { label: 'Total Returns', value: this.inr(totalReturns) },
        { label: 'Active Quotations', value: String(activeQuotationsCount) },
      ],
    };
  }

  // ── Supplier Ledger ────────────────────────────────────────────
  async getSupplierLedger(supplierId: string, query: PeriodQuery & { branchId?: string }) {
    // Mirror customer ledger: honour true "All Time" by omitting the date
    // filter when neither from nor to is supplied.
    const fromDate = query.from ? dayjs(query.from).startOf('day').toDate() : undefined;
    const toDate = query.to ? dayjs(query.to).endOf('day').toDate() : undefined;
    const dateFilter: { gte?: Date; lte?: Date } | undefined =
      fromDate || toDate
        ? { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) }
        : undefined;
    const bFilter = this.branchFilter(query.branchId);

    // Same branch-scope check as customer ledger: reject if the supplier
    // belongs to a different branch.
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) return { supplier: null, tableData: [], kpis: [] };
    if (query.branchId && supplier.branchId && supplier.branchId !== query.branchId) {
      return { supplier: null, tableData: [], kpis: [] };
    }

    // "Open POs" is a current snapshot, not a period stat — keep it un-filtered
    // by date. resolvePeriod() defaults `from` to start-of-current-month, so
    // applying it here makes the count always-zero for any supplier whose POs
    // pre-date this month.
    const openPOsCount = await this.prisma.purchaseOrder.count({
      where: {
        supplierId,
        ...bFilter,
        status: { in: ['DRAFT', 'SENT', 'ACKNOWLEDGED', 'PARTIALLY_RECEIVED'] },
      },
    });

    const grns = await this.prisma.gRN.findMany({
      where: { supplierId, ...(dateFilter ? { date: dateFilter } : {}), ...bFilter },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, supplierInvoiceAmount: true, isReplacement: true, grnNumber: true },
    });

    const purchaseReturns = await this.prisma.purchaseReturn.findMany({
      where: { supplierId, ...(dateFilter ? { createdAt: dateFilter } : {}), ...bFilter },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, totalAmount: true, debitNoteNo: true, settlementMode: true },
    });

    const payments = await this.prisma.supplierPayment.findMany({
      where: { supplierId, ...(dateFilter ? { createdAt: dateFilter } : {}), ...bFilter },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, amount: true, paymentNumber: true },
    });

    type LedgerEntry = { date: Date | string; ref: string; description: string; debit: number; credit: number; neutral?: boolean; balance?: number; sourceType: 'GRN' | 'PURCHASE_RETURN' | 'SUPPLIER_PAYMENT'; sourceId: string };
    const entries: LedgerEntry[] = [];

    // GRN debit = supplierInvoiceAmount (the figure that drives currentOutstanding;
    // totalAmount can differ). Replacement GRNs are stock-back, never a payable.
    grns.forEach((g) => entries.push({
      date: g.date,
      ref: g.grnNumber,
      description: 'Purchase Received',
      debit: g.isReplacement ? 0 : Number(g.supplierInvoiceAmount),
      credit: 0,
      sourceType: 'GRN',
      sourceId: g.id,
    }));

    purchaseReturns.forEach((r) => {
      // Only ADJUST-settlement returns move the balance (they reduce the
      // payable). REFUND (supplier paid cash back) and REPLACEMENT (goods-for-
      // goods) are money-neutral — shown for visibility but flagged `neutral`.
      const neutral = r.settlementMode !== 'ADJUST';
      const tag =
        r.settlementMode === 'REFUND' ? ' (Refund)'
        : r.settlementMode === 'REPLACEMENT' ? ' (Replacement)'
        : '';
      entries.push({
        date: r.createdAt,
        ref: r.debitNoteNo,
        description: `Purchase Return${tag}`,
        debit: 0,
        credit: Number(r.totalAmount),
        neutral,
        sourceType: 'PURCHASE_RETURN',
        sourceId: r.id,
      });
    });

    payments.forEach((p) => entries.push({
      date: p.createdAt,
      ref: p.paymentNumber,
      description: 'Payment Made',
      debit: 0,
      credit: Number(p.amount),
      sourceType: 'SUPPLIER_PAYMENT',
      sourceId: p.id,
    }));

    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let balance = 0;
    const ledger = entries.map((e) => {
      // Neutral rows (refund/replacement returns) display their amount but do
      // not move the running balance.
      if (!e.neutral) balance += e.debit - e.credit;
      return { ...e, date: new Date(e.date).toISOString(), balance };
    });

    const totalPurchases = entries.reduce((s, e) => s + (e.neutral ? 0 : e.debit), 0);
    // Total Returns is a "how much was returned" stat — counts all returns
    // regardless of settlement (the goods went back either way).
    const totalReturns = purchaseReturns.reduce((s, r) => s + Number(r.totalAmount), 0);
    const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);

    return {
      supplier,
      tableData: ledger,
      kpis: [
        { label: 'Total Purchases', value: this.inr(totalPurchases) },
        { label: 'Total Paid', value: this.inr(totalPaid) },
        { label: 'Total Returns', value: this.inr(totalReturns) },
        { label: 'Net Payable', value: this.inr(balance) },
        { label: 'Open POs', value: String(openPOsCount) },
      ],
    };
  }

  // ── Purchase Summary ───────────────────────────────────────────
  async getPurchaseSummary(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);
    const grns = await this.prisma.gRN.findMany({
      where: { date: { gte: from, lte: to }, ...bFilter },
      include: { supplier: { select: { name: true } }, items: true },
      orderBy: { date: 'asc' },
    });
    const tableData = grns.map((g) => ({
      date: g.date,
      grnNumber: g.grnNumber,
      supplier: g.supplier?.name ?? 'Unknown',
      items: g.items.length,
      amount: Number(g.totalAmount),
    }));
    const totalAmount = tableData.reduce((s, r) => s + r.amount, 0);
    const chartData = tableData.reduce((acc: { month: string; amount: number }[], row) => {
      const m = dayjs(row.date).format('MMM');
      const existing = acc.find((a) => a.month === m);
      if (existing) existing.amount += row.amount;
      else acc.push({ month: m, amount: row.amount });
      return acc;
    }, []);
    return {
      tableData,
      chartData,
      kpis: [
        { label: 'Total GRNs', value: grns.length.toString() },
        { label: 'Total Amount', value: this.inr(totalAmount) },
        { label: 'Avg. GRN Value', value: this.inr(grns.length ? totalAmount / grns.length : 0) },
      ],
    };
  }

  // ── Supplier-wise Purchase ──────────────────────────────────────
  async getSupplierPurchase(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);
    const grns = await this.prisma.gRN.findMany({
      where: { date: { gte: from, lte: to }, ...bFilter },
      include: { supplier: { select: { name: true } } },
    });
    const supplierMap = new Map<string, { supplier: string; grns: number; amount: number }>();
    grns.forEach((g) => {
      const key = g.supplierId;
      const cur = supplierMap.get(key) || { supplier: g.supplier?.name ?? 'Unknown', grns: 0, amount: 0 };
      cur.grns += 1;
      cur.amount += Number(g.totalAmount);
      supplierMap.set(key, cur);
    });
    const tableData = Array.from(supplierMap.values()).sort((a, b) => b.amount - a.amount);
    const total = tableData.reduce((s, r) => s + r.amount, 0);
    return {
      chartData: tableData.slice(0, 10),
      tableData,
      kpis: [
        { label: 'Suppliers', value: tableData.length.toString() },
        { label: 'Total Purchases', value: this.inr(total) },
        { label: 'Top Supplier', value: tableData[0]?.supplier ?? '—' },
      ],
    };
  }

  // ── Purchase vs Sales ──────────────────────────────────────────
  async getPurchaseVsSales(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);
    const invoices = await this.prisma.invoice.findMany({
      where: { date: { gte: from, lte: to }, ...bFilter },
      select: { date: true, grandTotal: true },
    });
    const grns = await this.prisma.gRN.findMany({
      where: { date: { gte: from, lte: to }, ...bFilter },
      select: { date: true, totalAmount: true },
    });
    const monthMap = new Map<string, { month: string; sales: number; purchases: number }>();
    invoices.forEach((inv) => {
      const m = dayjs(inv.date).format('MMM YY');
      const cur = monthMap.get(m) || { month: m, sales: 0, purchases: 0 };
      cur.sales += Number(inv.grandTotal);
      monthMap.set(m, cur);
    });
    grns.forEach((g) => {
      const m = dayjs(g.date).format('MMM YY');
      const cur = monthMap.get(m) || { month: m, sales: 0, purchases: 0 };
      cur.purchases += Number(g.totalAmount);
      monthMap.set(m, cur);
    });
    const chartData = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));
    const totalSales = invoices.reduce((s, i) => s + Number(i.grandTotal), 0);
    const totalPurchases = grns.reduce((s, g) => s + Number(g.totalAmount), 0);
    return {
      chartData,
      tableData: chartData,
      kpis: [
        { label: 'Total Sales', value: this.inr(totalSales) },
        { label: 'Total Purchases', value: this.inr(totalPurchases) },
        { label: 'Net Margin', value: this.inr(totalSales - totalPurchases) },
        { label: 'Margin %', value: totalSales > 0 ? `${(((totalSales - totalPurchases) / totalSales) * 100).toFixed(1)}%` : '0%' },
      ],
    };
  }

  // ── Category-wise Sales ────────────────────────────────────────
  async getCategorySales(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);
    const items = await this.prisma.invoiceItem.findMany({
      where: { invoice: { date: { gte: from, lte: to }, ...bFilter } },
      include: { invoice: { select: { date: true } } },
    });
    const products = await this.prisma.product.findMany({ select: { id: true, categoryId: true } });
    const catMap = new Map(products.map((p) => [p.id, p.categoryId ?? 'OTHER']));
    const byCategory = new Map<string, { category: string; qty: number; revenue: number }>();
    items.forEach((it) => {
      const cat = catMap.get(it.productId) ?? 'OTHER';
      const cur = byCategory.get(cat) || { category: cat, qty: 0, revenue: 0 };
      cur.qty += it.quantity;
      cur.revenue += Number(it.amount);
      byCategory.set(cat, cur);
    });
    const chartData = Array.from(byCategory.values()).sort((a, b) => b.revenue - a.revenue);
    const total = chartData.reduce((s, c) => s + c.revenue, 0);
    return {
      chartData,
      tableData: chartData,
      kpis: [
        { label: 'Categories', value: chartData.length.toString() },
        { label: 'Total Revenue', value: this.inr(total) },
        { label: 'Top Category', value: chartData[0]?.category ?? '—' },
      ],
    };
  }

  // ── Current Stock ──────────────────────────────────────────────
  async getCurrentStock(branchId?: string) {
    const products = await this.prisma.product.findMany({
      where: branchId ? { branchId } : undefined,
      include: { batches: { where: { quantity: { gt: 0 } } } },
      orderBy: { name: 'asc' },
    });
    const tableData = products.map((p) => ({
      product: p.name,
      category: p.categoryId ?? '',
      totalStock: p.totalStock,
      minStock: p.minStock,
      mrp: Number(p.mrp),
      status: p.totalStock === 0 ? 'OUT' : p.totalStock <= p.minStock ? 'LOW' : 'OK',
    }));
    const outOfStock = tableData.filter((r) => r.status === 'OUT').length;
    const lowStock = tableData.filter((r) => r.status === 'LOW').length;
    const chartData = tableData.slice(0, 20).map((r) => ({ product: r.product, stock: r.totalStock }));
    return {
      chartData,
      tableData,
      kpis: [
        { label: 'Total Products', value: tableData.length.toString() },
        { label: 'Out of Stock', value: outOfStock.toString() },
        { label: 'Low Stock', value: lowStock.toString() },
        { label: 'Healthy', value: (tableData.length - outOfStock - lowStock).toString() },
      ],
    };
  }

  // ── ABC Analysis ───────────────────────────────────────────────
  async getAbcAnalysis(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);
    const items = await this.prisma.invoiceItem.findMany({
      where: { invoice: { date: { gte: from, lte: to }, ...bFilter } },
    });
    const productMap = new Map<string, { product: string; revenue: number }>();
    items.forEach((it) => {
      const cur = productMap.get(it.productId) || { product: it.productName, revenue: 0 };
      cur.revenue += Number(it.amount);
      productMap.set(it.productId, cur);
    });
    const sorted = Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue);
    const total = sorted.reduce((s, p) => s + p.revenue, 0);
    let cumulative = 0;
    const tableData = sorted.map((p) => {
      cumulative += p.revenue;
      const cumPct = total > 0 ? (cumulative / total) * 100 : 0;
      const abc = cumPct <= 70 ? 'A' : cumPct <= 90 ? 'B' : 'C';
      return { ...p, cumPct: parseFloat(cumPct.toFixed(1)), abc };
    });
    const aCount = tableData.filter((r) => r.abc === 'A').length;
    const bCount = tableData.filter((r) => r.abc === 'B').length;
    const chartData = [
      { category: 'A (Top 70%)', count: aCount, revenue: tableData.filter((r) => r.abc === 'A').reduce((s, r) => s + r.revenue, 0) },
      { category: 'B (70-90%)', count: bCount, revenue: tableData.filter((r) => r.abc === 'B').reduce((s, r) => s + r.revenue, 0) },
      { category: 'C (Bottom 10%)', count: tableData.length - aCount - bCount, revenue: tableData.filter((r) => r.abc === 'C').reduce((s, r) => s + r.revenue, 0) },
    ];
    return {
      chartData,
      tableData,
      kpis: [
        { label: 'A Items', value: aCount.toString() },
        { label: 'B Items', value: bCount.toString() },
        { label: 'C Items', value: (tableData.length - aCount - bCount).toString() },
        { label: 'Total SKUs', value: tableData.length.toString() },
      ],
    };
  }

  // ── Expense Report ─────────────────────────────────────────────
  async getExpenseReport(query: PeriodQuery & { branchId?: string }) {
    const { from, to } = this.resolvePeriod(query);
    const bFilter = this.branchFilter(query.branchId);
    const expenses = await this.prisma.expense.findMany({
      where: { date: { gte: from, lte: to }, ...bFilter },
      orderBy: { date: 'asc' },
    });
    const byCat = new Map<string, { category: string; amount: number; count: number }>();
    expenses.forEach((e) => {
      const cur = byCat.get(e.category) || { category: e.category, amount: 0, count: 0 };
      cur.amount += Number(e.amount);
      cur.count += 1;
      byCat.set(e.category, cur);
    });
    const chartData = Array.from(byCat.values()).sort((a, b) => b.amount - a.amount);
    const tableData = expenses.map((e) => ({
      date: e.date,
      category: e.category,
      description: e.description,
      amount: Number(e.amount),
      paymentMode: e.paymentMode,
    }));
    const total = tableData.reduce((s, r) => s + r.amount, 0);
    return {
      chartData,
      tableData,
      kpis: [
        { label: 'Total Expenses', value: this.inr(total) },
        { label: 'Transactions', value: expenses.length.toString() },
        { label: 'Categories', value: chartData.length.toString() },
        { label: 'Avg. Expense', value: this.inr(expenses.length ? total / expenses.length : 0) },
      ],
    };
  }

  // ── Outstanding / Aged Receivables ─────────────────────────────
  async getOutstanding(branchId?: string) {
    const where: any = { currentOutstanding: { gt: 0 } };
    if (branchId) where.branchId = branchId;
    const customers = await this.prisma.customer.findMany({ where });

    const today = dayjs();
    const buckets = { current: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };

    const rows = await Promise.all(
      customers.map(async (c) => {
        const openInvoices = await this.prisma.invoice.findMany({
          where: {
            customerId: c.id,
            paymentMode: { in: ['CREDIT', 'SPLIT'] },
            status: { in: ['UNPAID', 'PARTIAL'] },
            ...(branchId ? { branchId } : {}),
          },
          orderBy: { date: 'asc' },
        });
        const agedBuckets = { current: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
        openInvoices.forEach((inv) => {
          const unpaid = Number(inv.grandTotal) - Number(inv.amountPaid);
          const days = today.diff(dayjs(inv.date), 'day');
          let b: keyof typeof agedBuckets = 'current';
          if (days > 90) b = '90+';
          else if (days > 60) b = '61-90';
          else if (days > 30) b = '31-60';
          else if (days > 0) b = '0-30';
          agedBuckets[b] += unpaid;
          buckets[b] += unpaid;
        });
        return {
          customerId: c.id,
          customer: c.name,
          phone: c.phone,
          creditLimit: Number(c.creditLimit),
          outstanding: Number(c.currentOutstanding),
          ...agedBuckets,
        };
      }),
    );

    return {
      tableData: rows.sort((a, b) => b.outstanding - a.outstanding),
      agingSummary: buckets,
      kpis: [
        { label: 'Customers with Dues', value: rows.length.toString() },
        { label: 'Total Outstanding', value: this.inr(rows.reduce((s, r) => s + r.outstanding, 0)) },
        { label: '90+ Days', value: this.inr(buckets['90+']) },
      ],
    };
  }
}
