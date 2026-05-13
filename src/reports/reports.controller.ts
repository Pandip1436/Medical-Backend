import { Controller, Get, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'KPI data for the main dashboard' })
  getDashboardKpis(@Request() req: any, @Query('branchId') branchId?: string) {
    return this.reportsService.getDashboardKpis(req.user.branchId ?? branchId);
  }

  // ── Sales ────────────────────────────────────────────────────
  @Get('sales/daily')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Hourly sales for the current day' })
  getDailySales(@Request() req: any, @Query('branchId') branchId?: string) {
    return this.reportsService.getDailySales(req.user.branchId ?? branchId);
  }

  @Get('sales/monthly')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Monthly sales for a year' })
  @ApiQuery({ name: 'year', required: false })
  getMonthlySales(@Request() req: any, @Query('year') year?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getMonthlySales(year, req.user.branchId ?? branchId);
  }

  @Get('sales/range')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Sales totals bucketed by day or month within an arbitrary range' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiQuery({ name: 'bucket', required: true, enum: ['day', 'month'] })
  @ApiQuery({ name: 'branchId', required: false })
  getSalesRange(
    @Request() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('bucket') bucket: 'day' | 'month',
    @Query('branchId') branchId?: string,
  ) {
    return this.reportsService.getSalesRange({
      from,
      to,
      bucket,
      branchId: req.user.branchId ?? branchId,
    });
  }

  @Get('sales/yearly')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Yearly sales across all years' })
  getYearlySales(@Request() req: any, @Query('branchId') branchId?: string) {
    return this.reportsService.getYearlySales(req.user.branchId ?? branchId);
  }

  @Get('sales/products')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Sales performance by product (top 20)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getProductSales(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getProductSales({ from, to, branchId: req.user.branchId ?? branchId });
  }

  @Get('sales/category')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Sales by product category' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getCategorySales(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getCategorySales({ from, to, branchId: req.user.branchId ?? branchId });
  }

  @Get('sales/customers')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Sales performance by customer' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getCustomerSales(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getCustomerSales({ from, to, branchId: req.user.branchId ?? branchId });
  }

  // ── Purchase ─────────────────────────────────────────────────
  @Get('purchase/summary')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Purchase summary with GRN data' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getPurchaseSummary(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getPurchaseSummary({ from, to, branchId: req.user.branchId ?? branchId });
  }

  @Get('purchase/by-supplier')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Purchase amounts grouped by supplier' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getSupplierPurchase(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getSupplierPurchase({ from, to, branchId: req.user.branchId ?? branchId });
  }

  @Get('purchase/vs-sales')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Purchase vs Sales comparison by month' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getPurchaseVsSales(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getPurchaseVsSales({ from, to, branchId: req.user.branchId ?? branchId });
  }

  // ── Inventory ─────────────────────────────────────────────────
  @Get('inventory/valuation')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Current stock valuation by category' })
  getStockValuation(@Request() req: any, @Query('branchId') branchId?: string) {
    return this.reportsService.getStockValuation(req.user.branchId ?? branchId);
  }

  @Get('inventory/current-stock')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Current stock levels for all products' })
  getCurrentStock(@Request() req: any, @Query('branchId') branchId?: string) {
    return this.reportsService.getCurrentStock(req.user.branchId ?? branchId);
  }

  @Get('inventory/abc-analysis')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'ABC analysis of products by revenue contribution' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getAbcAnalysis(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getAbcAnalysis({ from, to, branchId: req.user.branchId ?? branchId });
  }

  @Get('inventory/movement')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Stock movement (in/out) for a period' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getStockMovement(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getStockMovement({ from, to, branchId: req.user.branchId ?? branchId });
  }

  @Get('inventory/aging')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Stock aging by batch creation date' })
  getStockAging(@Request() req: any, @Query('branchId') branchId?: string) {
    return this.reportsService.getStockAging(req.user.branchId ?? branchId);
  }

  @Get('inventory/expiry')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Expired and near-expiry (90 days) batches' })
  getExpiryReport(@Request() req: any, @Query('branchId') branchId?: string) {
    return this.reportsService.getExpiryReport(req.user.branchId ?? branchId);
  }

  // ── Financial ─────────────────────────────────────────────────
  @Get('financial/profit-loss')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Profit & Loss statement for a period' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getProfitLoss(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getProfitLoss({ from, to, branchId: req.user.branchId ?? branchId });
  }

  @Get('financial/profit-loss/monthly')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Monthly revenue + net profit for a year (drives the P&L trend chart)' })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getMonthlyProfitLoss(@Request() req: any, @Query('year') year?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getMonthlyProfitLoss(
      year ? Number(year) : undefined,
      req.user.branchId ?? branchId,
    );
  }

  @Get('financial/cash-book')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Cash book with receipts and payments' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getCashBook(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getCashBook({ from, to, branchId: req.user.branchId ?? branchId });
  }

  @Get('financial/outstanding')
  @Roles('ADMIN', 'ACCOUNTANT', 'PHARMACIST')
  @ApiOperation({ summary: 'Customer outstanding with aging buckets' })
  @ApiQuery({ name: 'branchId', required: false })
  getOutstanding(@Request() req: any, @Query('branchId') branchId?: string) {
    return this.reportsService.getOutstanding(req.user.branchId ?? branchId);
  }

  @Get('financial/ledger/:customerId')
  @Roles('ADMIN', 'ACCOUNTANT', 'PHARMACIST')
  @ApiOperation({ summary: 'Customer ledger with debits/credits and running balance' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  getCustomerLedger(
    @Param('customerId') customerId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getCustomerLedger(customerId, { from, to });
  }

  @Get('financial/supplier-ledger/:supplierId')
  @Roles('ADMIN', 'ACCOUNTANT', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Supplier ledger with GRN purchases and purchase returns' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  getSupplierLedger(
    @Param('supplierId') supplierId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getSupplierLedger(supplierId, { from, to });
  }

  @Get('financial/expenses')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Expense report grouped by category' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getExpenseReport(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getExpenseReport({ from, to, branchId: req.user.branchId ?? branchId });
  }

  // ── GST ───────────────────────────────────────────────────────
  @Get('gst/gstr-1')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'GSTR-1 summary by tax slab' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getGstr1(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getGstr1Summary({ from, to, branchId: req.user.branchId ?? branchId });
  }

  @Get('gst/gstr-3b')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'GSTR-3B summary (outward + inward)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getGstr3b(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getGstr3bSummary({ from, to, branchId: req.user.branchId ?? branchId });
  }

  @Get('gst/hsn-summary')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'HSN-wise summary for GSTR-1' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  getHsnSummary(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string) {
    return this.reportsService.getHsnSummary({ from, to, branchId: req.user.branchId ?? branchId });
  }
}
