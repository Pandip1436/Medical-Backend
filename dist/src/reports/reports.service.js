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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const dayjs_1 = __importDefault(require("dayjs"));
let ReportsService = class ReportsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    resolvePeriod(q) {
        const from = q.from ? (0, dayjs_1.default)(q.from).startOf('day').toDate() : (0, dayjs_1.default)().startOf('month').toDate();
        const to = q.to ? (0, dayjs_1.default)(q.to).endOf('day').toDate() : (0, dayjs_1.default)().endOf('day').toDate();
        return { from, to, branchId: q.branchId };
    }
    branchFilter(branchId) {
        return branchId ? { branchId } : {};
    }
    inr(value) {
        return value.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
    }
    async getDashboardKpis(branchId) {
        const today = (0, dayjs_1.default)().startOf('day').toDate();
        const startOfMonth = (0, dayjs_1.default)().startOf('month').toDate();
        const bFilter = this.branchFilter(branchId);
        const sales = await this.prisma.invoice.aggregate({
            where: { date: { gte: startOfMonth }, ...bFilter },
            _sum: { grandTotal: true },
        });
        const todaysSales = await this.prisma.invoice.aggregate({
            where: { date: { gte: today }, ...bFilter },
            _sum: { grandTotal: true },
        });
        const outstanding = await this.prisma.customer.aggregate({
            where: branchId ? { branchId } : undefined,
            _sum: { currentOutstanding: true },
        });
        const now = new Date();
        const ninetyDaysFromNow = (0, dayjs_1.default)().add(90, 'days').toDate();
        const expiryCount = await this.prisma.batch.count({
            where: {
                expiryDate: { lte: ninetyDaysFromNow, gte: now },
                quantity: { gt: 0 },
                ...(branchId ? { product: { branchId } } : {}),
            },
        });
        const expiringBatches = await this.prisma.batch.findMany({
            where: {
                expiryDate: { lte: ninetyDaysFromNow, gte: now },
                quantity: { gt: 0 },
                ...(branchId ? { product: { branchId } } : {}),
            },
            orderBy: { expiryDate: 'asc' },
            take: 20,
            select: {
                id: true,
                batchNumber: true,
                expiryDate: true,
                quantity: true,
                product: { select: { name: true, packSize: true } },
            },
        });
        const products = await this.prisma.product.findMany({
            where: branchId ? { branchId } : undefined,
            select: { id: true, name: true, packSize: true, totalStock: true, minStock: true, reorderQty: true },
        });
        const lowStock = products.filter((p) => p.totalStock <= p.minStock);
        const lowStockItems = lowStock
            .map((p) => ({
            id: p.id,
            name: p.name,
            packSize: p.packSize,
            totalStock: p.totalStock,
            minStock: p.minStock,
            reorderQty: p.reorderQty,
            deficit: p.minStock - p.totalStock,
        }))
            .sort((a, b) => b.deficit - a.deficit)
            .slice(0, 20);
        const totalProducts = products.length;
        const recentInvoices = await this.prisma.invoice.findMany({
            take: 20,
            orderBy: { date: 'desc' },
            where: { ...bFilter },
            include: { items: { select: { productName: true, quantity: true } } },
        });
        const overdueCutoff = (0, dayjs_1.default)().subtract(30, 'day').toDate();
        const overdueInvoices = await this.prisma.invoice.findMany({
            where: {
                paymentMode: { in: ['CREDIT', 'SPLIT'] },
                status: { in: ['CREDIT', 'PARTIAL'] },
                date: { lte: overdueCutoff },
                ...bFilter,
            },
            select: { customerId: true, customerName: true, date: true, grandTotal: true, amountPaid: true },
            orderBy: { date: 'asc' },
        });
        const overdueByCustomer = new Map();
        overdueInvoices.forEach((inv) => {
            const unpaid = Number(inv.grandTotal) - Number(inv.amountPaid);
            if (unpaid <= 0)
                return;
            const key = inv.customerId ?? inv.customerName;
            const cur = overdueByCustomer.get(key);
            if (cur) {
                cur.overdueAmount += unpaid;
                cur.invoiceCount += 1;
                if (inv.date < cur.oldestDate)
                    cur.oldestDate = inv.date;
            }
            else {
                overdueByCustomer.set(key, {
                    customerId: inv.customerId ?? '',
                    customerName: inv.customerName,
                    overdueAmount: unpaid,
                    oldestDate: inv.date,
                    invoiceCount: 1,
                });
            }
        });
        const overdueCustomers = Array.from(overdueByCustomer.values())
            .map((c) => ({
            customerId: c.customerId,
            customerName: c.customerName,
            overdueAmount: c.overdueAmount,
            daysOverdue: (0, dayjs_1.default)().diff((0, dayjs_1.default)(c.oldestDate), 'day'),
            invoiceCount: c.invoiceCount,
        }))
            .sort((a, b) => b.overdueAmount - a.overdueAmount)
            .slice(0, 20);
        const overdueCustomersCount = overdueByCustomer.size;
        const overdueTotal = Array.from(overdueByCustomer.values()).reduce((s, c) => s + c.overdueAmount, 0);
        return {
            monthlySales: sales._sum.grandTotal || 0,
            todaysSales: todaysSales._sum.grandTotal || 0,
            totalOutstanding: outstanding._sum.currentOutstanding || 0,
            expiringBatchesCount: expiryCount,
            lowStockAlertsCount: lowStock.length,
            totalProducts,
            recentInvoices,
            lowStockItems,
            expiringBatches,
            overdueCustomers,
            overdueCustomersCount,
            overdueTotal,
        };
    }
    async getSalesRange(query) {
        const bFilter = this.branchFilter(query.branchId);
        const start = (0, dayjs_1.default)(query.from).startOf('day');
        const end = (0, dayjs_1.default)(query.to).endOf('day');
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
                const idx = (0, dayjs_1.default)(inv.date).startOf('day').diff(start.startOf('day'), 'day');
                if (idx >= 0 && idx < chartData.length) {
                    chartData[idx].amount += Number(inv.grandTotal);
                }
            });
            return { bucket: 'day', chartData, total, invoiceCount };
        }
        const monthsMap = new Map();
        let cursor = start.startOf('month');
        while (cursor.isBefore(end) || cursor.isSame(end, 'month')) {
            const key = cursor.format('YYYY-MM');
            monthsMap.set(key, { label: cursor.format('MMM'), amount: 0, iso: key });
            cursor = cursor.add(1, 'month');
        }
        invoices.forEach((inv) => {
            const key = (0, dayjs_1.default)(inv.date).format('YYYY-MM');
            const entry = monthsMap.get(key);
            if (entry)
                entry.amount += Number(inv.grandTotal);
        });
        return { bucket: 'month', chartData: Array.from(monthsMap.values()), total, invoiceCount };
    }
    async getDailySales(branchId) {
        const bFilter = this.branchFilter(branchId);
        const today = (0, dayjs_1.default)().startOf('day').toDate();
        const tomorrow = (0, dayjs_1.default)().add(1, 'day').startOf('day').toDate();
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
            time: (0, dayjs_1.default)(inv.date).format('hh:mm A'),
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
    async getMonthlySales(year, branchId) {
        const bFilter = this.branchFilter(branchId);
        const yr = year ? parseInt(year, 10) : (0, dayjs_1.default)().year();
        const start = (0, dayjs_1.default)(`${yr}-01-01`).startOf('year').toDate();
        const end = (0, dayjs_1.default)(`${yr}-12-31`).endOf('year').toDate();
        const invoices = await this.prisma.invoice.findMany({
            where: { date: { gte: start, lte: end }, ...bFilter },
            select: { date: true, grandTotal: true },
        });
        const chartData = Array.from({ length: 12 }, (_, i) => ({
            month: (0, dayjs_1.default)().month(i).format('MMM'),
            amount: 0,
            invoices: 0,
        }));
        invoices.forEach((inv) => {
            const m = (0, dayjs_1.default)(inv.date).month();
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
    async getYearlySales(branchId) {
        const bFilter = this.branchFilter(branchId);
        const invoices = await this.prisma.invoice.findMany({
            where: { ...bFilter },
            select: { date: true, grandTotal: true },
        });
        const byYear = new Map();
        invoices.forEach((inv) => {
            const y = (0, dayjs_1.default)(inv.date).year();
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
    async getProductSales(query) {
        const { from, to } = this.resolvePeriod(query);
        const bFilter = this.branchFilter(query.branchId);
        const items = await this.prisma.invoiceItem.findMany({
            where: { invoice: { date: { gte: from, lte: to }, ...bFilter } },
            include: { invoice: { select: { date: true } } },
        });
        const productStats = new Map();
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
            revenue: ps.revenue,
            qtySold: ps.qtySold,
            margin: ps.revenue > 0 ? ((ps.revenue - ps.cost) / ps.revenue) * 100 : 0,
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
                    value: chartData.length > 0
                        ? `${(chartData.reduce((s, c) => s + c.margin, 0) / chartData.length).toFixed(1)}%`
                        : '0%',
                },
            ],
        };
    }
    async getCustomerSales(query) {
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
        const stats = new Map();
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
    async getStockValuation(branchId) {
        const batches = await this.prisma.batch.findMany({
            where: branchId ? { product: { branchId } } : undefined,
            include: { product: { include: { category: true } } },
        });
        const categoryValuation = new Map();
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
    async getStockMovement(query) {
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
        const byProduct = new Map();
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
    async getStockAging(branchId) {
        const today = (0, dayjs_1.default)();
        const batches = await this.prisma.batch.findMany({
            where: { quantity: { gt: 0 }, ...(branchId ? { product: { branchId } } : {}) },
            include: { product: true },
        });
        const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '91-180': 0, '180+': 0 };
        const tableData = batches.map((b) => {
            const age = today.diff((0, dayjs_1.default)(b.createdAt), 'day');
            let bucket = '0-30';
            if (age > 180)
                bucket = '180+';
            else if (age > 90)
                bucket = '91-180';
            else if (age > 60)
                bucket = '61-90';
            else if (age > 30)
                bucket = '31-60';
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
    async getExpiryReport(branchId) {
        const today = new Date();
        const ninetyDays = (0, dayjs_1.default)().add(90, 'days').toDate();
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
        const mapBatch = (b, status) => ({
            product: b.product.name,
            batch: b.batchNumber,
            expiryDate: b.expiryDate,
            qty: b.quantity,
            mrpValue: Number(b.mrp) * b.quantity,
            purchaseValue: Number(b.purchaseRate) * b.quantity,
            supplier: b.supplier?.name,
            daysToExpiry: (0, dayjs_1.default)(b.expiryDate).diff((0, dayjs_1.default)(), 'day'),
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
    async getProfitLoss(query) {
        const { from, to } = this.resolvePeriod(query);
        const bFilter = this.branchFilter(query.branchId);
        const invoiceWhere = {
            date: { gte: from, lte: to },
            type: 'INVOICE',
            status: { notIn: ['DRAFT', 'CANCELLED'] },
            ...bFilter,
        };
        const invoices = await this.prisma.invoice.findMany({
            where: invoiceWhere,
            include: { items: true },
        });
        const batchIds = Array.from(new Set(invoices.flatMap((inv) => inv.items.map((it) => it.batchId).filter(Boolean))));
        const batches = batchIds.length
            ? await this.prisma.batch.findMany({
                where: { id: { in: batchIds } },
                select: { id: true, purchaseRate: true },
            })
            : [];
        const purchaseRateByBatchId = new Map(batches.map((b) => [b.id, Number(b.purchaseRate ?? 0)]));
        const creditNotes = await this.prisma.creditNote.aggregate({
            where: { date: { gte: from, lte: to }, ...bFilter },
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
        const totalTax = invoices.reduce((s, inv) => s + Number(inv.cgst) + Number(inv.sgst) + Number(inv.igst), 0);
        const salesReturn = Number(creditNotes._sum.totalAmount ?? 0);
        const netSales = grossSales - salesReturn;
        const costOfGoods = invoices.reduce((s, inv) => s +
            inv.items.reduce((si, it) => {
                const cost = purchaseRateByBatchId.get(it.batchId) ?? 0;
                return si + cost * Number(it.quantity);
            }, 0), 0);
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
    async getMonthlyProfitLoss(year, branchId) {
        const targetYear = year ?? new Date().getFullYear();
        const months = Array.from({ length: 12 }, (_, i) => i);
        const results = await Promise.all(months.map(async (m) => {
            const from = new Date(targetYear, m, 1).toISOString().slice(0, 10);
            const to = new Date(targetYear, m + 1, 0).toISOString().slice(0, 10);
            const pl = await this.getProfitLoss({ from, to, branchId });
            const find = (label) => Number(pl.lineItems.find((li) => li.label === label)?.amount ?? 0);
            return {
                month: new Date(targetYear, m, 1).toLocaleString('en-IN', { month: 'short' }),
                revenue: find('Net Sales'),
                profit: find('Net Profit'),
            };
        }));
        return { year: targetYear, chartData: results };
    }
    async getGstr1Summary(query) {
        const { from, to } = this.resolvePeriod(query);
        const bFilter = this.branchFilter(query.branchId);
        const invoices = await this.prisma.invoice.findMany({
            where: { date: { gte: from, lte: to }, type: 'INVOICE', ...bFilter },
            include: { items: true },
        });
        const creditNotes = await this.prisma.creditNote.findMany({
            where: { date: { gte: from, lte: to }, ...bFilter },
        });
        const bySlab = new Map();
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
        const tableData = Array.from(bySlab.values()).sort((a, b) => a.gstRate - b.gstRate);
        const totals = tableData.reduce((s, t) => ({
            taxable: s.taxable + t.taxable,
            cgst: s.cgst + t.cgst,
            sgst: s.sgst + t.sgst,
            igst: s.igst + t.igst,
        }), { taxable: 0, cgst: 0, sgst: 0, igst: 0 });
        const creditNoteTotal = creditNotes.reduce((s, c) => s + Number(c.totalAmount), 0);
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
    async getGstr3bSummary(query) {
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
        const cgst = Number(outward._sum.cgst ?? 0);
        const sgst = Number(outward._sum.sgst ?? 0);
        const igst = Number(outward._sum.igst ?? 0);
        return {
            period: { from, to },
            outwardSupplies: {
                taxableValue: Number(outward._sum.taxableAmount ?? 0),
                cgst,
                sgst,
                igst,
                totalTax: cgst + sgst + igst,
            },
            inwardSupplies: {
                totalValue: Number(inward._sum.totalAmount ?? 0),
            },
            kpis: [
                { label: 'Outward Taxable', value: this.inr(Number(outward._sum.taxableAmount ?? 0)) },
                { label: 'Tax Payable', value: this.inr(cgst + sgst + igst) },
                { label: 'Inward Supplies', value: this.inr(Number(inward._sum.totalAmount ?? 0)) },
            ],
        };
    }
    async getHsnSummary(query) {
        const { from, to } = this.resolvePeriod(query);
        const bFilter = this.branchFilter(query.branchId);
        const items = await this.prisma.invoiceItem.findMany({
            where: { invoice: { date: { gte: from, lte: to }, type: 'INVOICE', ...bFilter } },
        });
        const products = await this.prisma.product.findMany({
            select: { id: true, hsnCode: true, unitOfMeasure: true },
        });
        const productMap = new Map(products.map((p) => [p.id, p]));
        const byHsn = new Map();
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
        const tableData = Array.from(byHsn.values()).sort((a, b) => b.taxable - a.taxable);
        const totals = tableData.reduce((s, t) => ({ taxable: s.taxable + t.taxable, tax: s.tax + t.tax, qty: s.qty + t.qty }), { taxable: 0, tax: 0, qty: 0 });
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
    async getCashBook(query) {
        const { from, to } = this.resolvePeriod(query);
        const bFilter = this.branchFilter(query.branchId);
        const cashInvoices = await this.prisma.invoice.findMany({
            where: {
                date: { gte: from, lte: to },
                paymentMode: { in: ['CASH', 'SPLIT'] },
                ...bFilter,
            },
            orderBy: { date: 'asc' },
            select: {
                id: true,
                date: true,
                invoiceNumber: true,
                customerName: true,
                amountPaid: true,
                paymentMode: true,
            },
        });
        const cashExpenses = await this.prisma.expense.findMany({
            where: {
                date: { gte: from, lte: to },
                paymentMode: { equals: 'CASH', mode: 'insensitive' },
                ...bFilter,
            },
            orderBy: { date: 'asc' },
        });
        const receipts = cashInvoices.map((inv) => ({
            date: inv.date,
            ref: inv.invoiceNumber,
            description: `Sale to ${inv.customerName}`,
            amount: Number(inv.amountPaid),
            type: 'RECEIPT',
        }));
        const payments = cashExpenses.map((e) => ({
            date: e.date,
            ref: e.id.slice(0, 8),
            description: `${e.category}: ${e.description}`,
            amount: Number(e.amount),
            type: 'PAYMENT',
        }));
        const totalReceipts = receipts.reduce((s, r) => s + r.amount, 0);
        const totalPayments = payments.reduce((s, p) => s + p.amount, 0);
        const entries = [...receipts, ...payments].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const [priorReceipts, priorPayments] = await Promise.all([
            this.prisma.invoice.aggregate({
                where: {
                    date: { lt: from },
                    paymentMode: { in: ['CASH', 'SPLIT'] },
                    ...bFilter,
                },
                _sum: { amountPaid: true },
            }),
            this.prisma.expense.aggregate({
                where: {
                    date: { lt: from },
                    paymentMode: { equals: 'CASH', mode: 'insensitive' },
                    ...bFilter,
                },
                _sum: { amount: true },
            }),
        ]);
        const openingBalance = Number(priorReceipts._sum.amountPaid ?? 0) -
            Number(priorPayments._sum.amount ?? 0);
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
    async getCustomerLedger(customerId, query) {
        const { from, to } = this.resolvePeriod(query);
        const bFilter = this.branchFilter(query.branchId);
        const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
        if (!customer)
            return { customer: null, tableData: [], kpis: [] };
        if (query.branchId && customer.branchId && customer.branchId !== query.branchId) {
            return { customer: null, tableData: [], kpis: [] };
        }
        const invoices = await this.prisma.invoice.findMany({
            where: { customerId, date: { gte: from, lte: to }, ...bFilter },
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
        const creditNotes = await this.prisma.creditNote.findMany({
            where: { customerId, date: { gte: from, lte: to }, ...bFilter },
            orderBy: { date: 'asc' },
        });
        const entries = [];
        invoices.forEach((inv) => {
            entries.push({
                date: inv.date,
                ref: inv.invoiceNumber,
                description: `Invoice`,
                debit: Number(inv.grandTotal),
                credit: 0,
            });
            if (Number(inv.amountPaid) > 0) {
                entries.push({
                    date: inv.date,
                    ref: inv.invoiceNumber,
                    description: `Payment (${inv.paymentMode})`,
                    debit: 0,
                    credit: Number(inv.amountPaid),
                });
            }
        });
        creditNotes.forEach((cn) => {
            entries.push({
                date: cn.date,
                ref: cn.creditNoteNo,
                description: `Credit Note: ${cn.reason}`,
                debit: 0,
                credit: Number(cn.totalAmount),
            });
        });
        entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        let balance = 0;
        const ledger = entries.map((e) => {
            balance += e.debit - e.credit;
            return { ...e, balance };
        });
        const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
        const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
        return {
            customer,
            tableData: ledger,
            kpis: [
                { label: 'Total Debit', value: this.inr(totalDebit) },
                { label: 'Total Credit', value: this.inr(totalCredit) },
                { label: 'Closing Balance', value: this.inr(balance) },
                { label: 'Outstanding', value: this.inr(Number(customer.currentOutstanding)) },
            ],
        };
    }
    async getSupplierLedger(supplierId, query) {
        const { from, to } = this.resolvePeriod(query);
        const bFilter = this.branchFilter(query.branchId);
        const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!supplier)
            return { supplier: null, tableData: [], kpis: [] };
        if (query.branchId && supplier.branchId && supplier.branchId !== query.branchId) {
            return { supplier: null, tableData: [], kpis: [] };
        }
        const orders = await this.prisma.purchaseOrder.findMany({
            where: { supplierId, date: { gte: from, lte: to }, ...bFilter },
            orderBy: { date: 'asc' },
            select: { id: true, date: true, totalAmount: true, status: true, poNumber: true },
        });
        const grns = await this.prisma.gRN.findMany({
            where: { supplierId, date: { gte: from, lte: to }, ...bFilter },
            orderBy: { date: 'asc' },
            select: { id: true, date: true, totalAmount: true, grnNumber: true },
        });
        const purchaseReturns = await this.prisma.purchaseReturn.findMany({
            where: { supplierId, createdAt: { gte: from, lte: to }, ...bFilter },
            orderBy: { createdAt: 'asc' },
            select: { id: true, createdAt: true, totalAmount: true, debitNoteNo: true },
        });
        const entries = [];
        grns.forEach((g) => entries.push({
            date: g.date,
            ref: g.grnNumber,
            description: 'Goods Received',
            debit: Number(g.totalAmount),
            credit: 0,
        }));
        purchaseReturns.forEach((r) => entries.push({
            date: r.createdAt,
            ref: r.debitNoteNo,
            description: 'Purchase Return',
            debit: 0,
            credit: Number(r.totalAmount),
        }));
        entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        let balance = 0;
        const ledger = entries.map((e) => {
            balance += e.debit - e.credit;
            return { ...e, date: new Date(e.date).toISOString(), balance };
        });
        const totalPurchases = entries.reduce((s, e) => s + e.debit, 0);
        const totalReturns = entries.reduce((s, e) => s + e.credit, 0);
        const openPOs = orders.filter((o) => o.status === 'DRAFT' || o.status === 'SENT' || o.status === 'ACKNOWLEDGED' || o.status === 'PARTIALLY_RECEIVED').length;
        return {
            supplier,
            tableData: ledger,
            kpis: [
                { label: 'Total Purchases', value: this.inr(totalPurchases) },
                { label: 'Total Returns', value: this.inr(totalReturns) },
                { label: 'Net Payable', value: this.inr(balance) },
                { label: 'Open POs', value: String(openPOs) },
            ],
        };
    }
    async getPurchaseSummary(query) {
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
        const chartData = tableData.reduce((acc, row) => {
            const m = (0, dayjs_1.default)(row.date).format('MMM');
            const existing = acc.find((a) => a.month === m);
            if (existing)
                existing.amount += row.amount;
            else
                acc.push({ month: m, amount: row.amount });
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
    async getSupplierPurchase(query) {
        const { from, to } = this.resolvePeriod(query);
        const bFilter = this.branchFilter(query.branchId);
        const grns = await this.prisma.gRN.findMany({
            where: { date: { gte: from, lte: to }, ...bFilter },
            include: { supplier: { select: { name: true } } },
        });
        const supplierMap = new Map();
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
    async getPurchaseVsSales(query) {
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
        const monthMap = new Map();
        invoices.forEach((inv) => {
            const m = (0, dayjs_1.default)(inv.date).format('MMM YY');
            const cur = monthMap.get(m) || { month: m, sales: 0, purchases: 0 };
            cur.sales += Number(inv.grandTotal);
            monthMap.set(m, cur);
        });
        grns.forEach((g) => {
            const m = (0, dayjs_1.default)(g.date).format('MMM YY');
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
    async getCategorySales(query) {
        const { from, to } = this.resolvePeriod(query);
        const bFilter = this.branchFilter(query.branchId);
        const items = await this.prisma.invoiceItem.findMany({
            where: { invoice: { date: { gte: from, lte: to }, ...bFilter } },
            include: { invoice: { select: { date: true } } },
        });
        const products = await this.prisma.product.findMany({ select: { id: true, categoryId: true } });
        const catMap = new Map(products.map((p) => [p.id, p.categoryId ?? 'OTHER']));
        const byCategory = new Map();
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
    async getCurrentStock(branchId) {
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
    async getAbcAnalysis(query) {
        const { from, to } = this.resolvePeriod(query);
        const bFilter = this.branchFilter(query.branchId);
        const items = await this.prisma.invoiceItem.findMany({
            where: { invoice: { date: { gte: from, lte: to }, ...bFilter } },
        });
        const productMap = new Map();
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
    async getExpenseReport(query) {
        const { from, to } = this.resolvePeriod(query);
        const bFilter = this.branchFilter(query.branchId);
        const expenses = await this.prisma.expense.findMany({
            where: { date: { gte: from, lte: to }, ...bFilter },
            orderBy: { date: 'asc' },
        });
        const byCat = new Map();
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
    async getOutstanding(branchId) {
        const where = { currentOutstanding: { gt: 0 } };
        if (branchId)
            where.branchId = branchId;
        const customers = await this.prisma.customer.findMany({ where });
        const today = (0, dayjs_1.default)();
        const buckets = { current: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
        const rows = await Promise.all(customers.map(async (c) => {
            const openInvoices = await this.prisma.invoice.findMany({
                where: {
                    customerId: c.id,
                    paymentMode: { in: ['CREDIT', 'SPLIT'] },
                    status: { in: ['CREDIT', 'PARTIAL'] },
                    ...(branchId ? { branchId } : {}),
                },
                orderBy: { date: 'asc' },
            });
            const agedBuckets = { current: 0, '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
            openInvoices.forEach((inv) => {
                const unpaid = Number(inv.grandTotal) - Number(inv.amountPaid);
                const days = today.diff((0, dayjs_1.default)(inv.date), 'day');
                let b = 'current';
                if (days > 90)
                    b = '90+';
                else if (days > 60)
                    b = '61-90';
                else if (days > 30)
                    b = '31-60';
                else if (days > 0)
                    b = '0-30';
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
        }));
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
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReportsService);
//# sourceMappingURL=reports.service.js.map