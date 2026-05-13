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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsController = void 0;
const common_1 = require("@nestjs/common");
const reports_service_1 = require("./reports.service");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
let ReportsController = class ReportsController {
    reportsService;
    constructor(reportsService) {
        this.reportsService = reportsService;
    }
    getDashboardKpis(req, branchId) {
        return this.reportsService.getDashboardKpis(req.user.branchId ?? branchId);
    }
    getDailySales(req, branchId) {
        return this.reportsService.getDailySales(req.user.branchId ?? branchId);
    }
    getMonthlySales(req, year, branchId) {
        return this.reportsService.getMonthlySales(year, req.user.branchId ?? branchId);
    }
    getSalesRange(req, from, to, bucket, branchId) {
        return this.reportsService.getSalesRange({
            from,
            to,
            bucket,
            branchId: req.user.branchId ?? branchId,
        });
    }
    getYearlySales(req, branchId) {
        return this.reportsService.getYearlySales(req.user.branchId ?? branchId);
    }
    getProductSales(req, from, to, branchId) {
        return this.reportsService.getProductSales({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getCategorySales(req, from, to, branchId) {
        return this.reportsService.getCategorySales({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getCustomerSales(req, from, to, branchId) {
        return this.reportsService.getCustomerSales({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getPurchaseSummary(req, from, to, branchId) {
        return this.reportsService.getPurchaseSummary({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getSupplierPurchase(req, from, to, branchId) {
        return this.reportsService.getSupplierPurchase({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getPurchaseVsSales(req, from, to, branchId) {
        return this.reportsService.getPurchaseVsSales({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getStockValuation(req, branchId) {
        return this.reportsService.getStockValuation(req.user.branchId ?? branchId);
    }
    getCurrentStock(req, branchId) {
        return this.reportsService.getCurrentStock(req.user.branchId ?? branchId);
    }
    getAbcAnalysis(req, from, to, branchId) {
        return this.reportsService.getAbcAnalysis({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getStockMovement(req, from, to, branchId) {
        return this.reportsService.getStockMovement({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getStockAging(req, branchId) {
        return this.reportsService.getStockAging(req.user.branchId ?? branchId);
    }
    getExpiryReport(req, branchId) {
        return this.reportsService.getExpiryReport(req.user.branchId ?? branchId);
    }
    getProfitLoss(req, from, to, branchId) {
        return this.reportsService.getProfitLoss({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getMonthlyProfitLoss(req, year, branchId) {
        return this.reportsService.getMonthlyProfitLoss(year ? Number(year) : undefined, req.user.branchId ?? branchId);
    }
    getCashBook(req, from, to, branchId) {
        return this.reportsService.getCashBook({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getOutstanding(req, branchId) {
        return this.reportsService.getOutstanding(req.user.branchId ?? branchId);
    }
    getCustomerLedger(customerId, from, to) {
        return this.reportsService.getCustomerLedger(customerId, { from, to });
    }
    getSupplierLedger(supplierId, from, to) {
        return this.reportsService.getSupplierLedger(supplierId, { from, to });
    }
    getExpenseReport(req, from, to, branchId) {
        return this.reportsService.getExpenseReport({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getGstr1(req, from, to, branchId) {
        return this.reportsService.getGstr1Summary({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getGstr3b(req, from, to, branchId) {
        return this.reportsService.getGstr3bSummary({ from, to, branchId: req.user.branchId ?? branchId });
    }
    getHsnSummary(req, from, to, branchId) {
        return this.reportsService.getHsnSummary({ from, to, branchId: req.user.branchId ?? branchId });
    }
};
exports.ReportsController = ReportsController;
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'KPI data for the main dashboard' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getDashboardKpis", null);
__decorate([
    (0, common_1.Get)('sales/daily'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Hourly sales for the current day' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getDailySales", null);
__decorate([
    (0, common_1.Get)('sales/monthly'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Monthly sales for a year' }),
    (0, swagger_1.ApiQuery)({ name: 'year', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('year')),
    __param(2, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getMonthlySales", null);
__decorate([
    (0, common_1.Get)('sales/range'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Sales totals bucketed by day or month within an arbitrary range' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: true }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: true }),
    (0, swagger_1.ApiQuery)({ name: 'bucket', required: true, enum: ['day', 'month'] }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('bucket')),
    __param(4, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getSalesRange", null);
__decorate([
    (0, common_1.Get)('sales/yearly'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Yearly sales across all years' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getYearlySales", null);
__decorate([
    (0, common_1.Get)('sales/products'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Sales performance by product (top 20)' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getProductSales", null);
__decorate([
    (0, common_1.Get)('sales/category'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Sales by product category' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getCategorySales", null);
__decorate([
    (0, common_1.Get)('sales/customers'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Sales performance by customer' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getCustomerSales", null);
__decorate([
    (0, common_1.Get)('purchase/summary'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Purchase summary with GRN data' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getPurchaseSummary", null);
__decorate([
    (0, common_1.Get)('purchase/by-supplier'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Purchase amounts grouped by supplier' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getSupplierPurchase", null);
__decorate([
    (0, common_1.Get)('purchase/vs-sales'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Purchase vs Sales comparison by month' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getPurchaseVsSales", null);
__decorate([
    (0, common_1.Get)('inventory/valuation'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Current stock valuation by category' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getStockValuation", null);
__decorate([
    (0, common_1.Get)('inventory/current-stock'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Current stock levels for all products' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getCurrentStock", null);
__decorate([
    (0, common_1.Get)('inventory/abc-analysis'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'ABC analysis of products by revenue contribution' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getAbcAnalysis", null);
__decorate([
    (0, common_1.Get)('inventory/movement'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Stock movement (in/out) for a period' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getStockMovement", null);
__decorate([
    (0, common_1.Get)('inventory/aging'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Stock aging by batch creation date' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getStockAging", null);
__decorate([
    (0, common_1.Get)('inventory/expiry'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Expired and near-expiry (90 days) batches' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getExpiryReport", null);
__decorate([
    (0, common_1.Get)('financial/profit-loss'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Profit & Loss statement for a period' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getProfitLoss", null);
__decorate([
    (0, common_1.Get)('financial/profit-loss/monthly'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Monthly revenue + net profit for a year (drives the P&L trend chart)' }),
    (0, swagger_1.ApiQuery)({ name: 'year', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('year')),
    __param(2, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getMonthlyProfitLoss", null);
__decorate([
    (0, common_1.Get)('financial/cash-book'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Cash book with receipts and payments' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getCashBook", null);
__decorate([
    (0, common_1.Get)('financial/outstanding'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT', 'PHARMACIST'),
    (0, swagger_1.ApiOperation)({ summary: 'Customer outstanding with aging buckets' }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getOutstanding", null);
__decorate([
    (0, common_1.Get)('financial/ledger/:customerId'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT', 'PHARMACIST'),
    (0, swagger_1.ApiOperation)({ summary: 'Customer ledger with debits/credits and running balance' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    __param(0, (0, common_1.Param)('customerId')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getCustomerLedger", null);
__decorate([
    (0, common_1.Get)('financial/supplier-ledger/:supplierId'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Supplier ledger with GRN purchases and purchase returns' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    __param(0, (0, common_1.Param)('supplierId')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getSupplierLedger", null);
__decorate([
    (0, common_1.Get)('financial/expenses'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Expense report grouped by category' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getExpenseReport", null);
__decorate([
    (0, common_1.Get)('gst/gstr-1'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'GSTR-1 summary by tax slab' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getGstr1", null);
__decorate([
    (0, common_1.Get)('gst/gstr-3b'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'GSTR-3B summary (outward + inward)' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getGstr3b", null);
__decorate([
    (0, common_1.Get)('gst/hsn-summary'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'HSN-wise summary for GSTR-1' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getHsnSummary", null);
exports.ReportsController = ReportsController = __decorate([
    (0, swagger_1.ApiTags)('reports'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('api/v1/reports'),
    __metadata("design:paramtypes", [reports_service_1.ReportsService])
], ReportsController);
//# sourceMappingURL=reports.controller.js.map