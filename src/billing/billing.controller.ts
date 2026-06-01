import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BillingService } from './billing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PaymentsService } from '../payments/payments.service';
import { ReconciliationService } from '../payments/reconciliation.service';

@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly paymentsService: PaymentsService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Post()
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Create a new invoice transaction' })
  create(@Body() createInvoiceDto: CreateInvoiceDto, @Request() req: any, @Query('branchId') branchId?: string) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.billingService.create(createInvoiceDto, req.user.userId, effectiveBranchId, req.user.role);
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Get all invoices or search' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'type', required: false, description: 'INVOICE or QUOTATION' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'paymentMode', required: false })
  @ApiQuery({ name: 'salespersonId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date (inclusive)' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date (inclusive)' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  findAll(
    @Request() req: any,
    @Query('q') q?: string,
    @Query('customerId') customerId?: string,
    @Query('branchId') branchId?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('paymentMode') paymentMode?: string,
    @Query('salespersonId') salespersonId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    const skipNum = skip !== undefined ? Number(skip) : undefined;
    const takeNum = take !== undefined ? Number(take) : undefined;
    return this.billingService.findAll(
      q,
      customerId,
      effectiveBranchId,
      type,
      {
        status: status || undefined,
        paymentMode: paymentMode || undefined,
        salespersonId: salespersonId || undefined,
        from: from || undefined,
        to: to || undefined,
      },
      Number.isFinite(skipNum) ? skipNum : undefined,
      Number.isFinite(takeNum) ? takeNum : undefined,
    );
  }

  // NOTE: keep this above `@Get(':id')` so 'summary' doesn't get captured as an id.
  @Get('summary')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Global invoice counts + totals (for stat cards)' })
  @ApiQuery({ name: 'branchId', required: false })
  summary(@Request() req: any, @Query('branchId') branchId?: string) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.billingService.summary(effectiveBranchId);
  }

  // Past purchases of specific products by a customer. Queries InvoiceItem
  // directly so it is NOT bound by the 200-invoice cap that the general
  // findAll() applies — a customer who has 500 invoices but only bought 3
  // products from us repeatedly will still see all their past purchases here.
  // Used by the New Sale page's Product History tab.
  @Get('product-purchases')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Past purchases of specific products by a customer (uncapped per product).' })
  @ApiQuery({ name: 'customerId', required: true })
  @ApiQuery({ name: 'productIds', required: true, description: 'Comma-separated product ids' })
  @ApiQuery({ name: 'perProductLimit', required: false, type: Number, description: 'Max entries per product (default 100, max 500)' })
  productPurchases(
    @Request() req: any,
    @Query('customerId') customerId: string,
    @Query('productIds') productIds: string,
    @Query('perProductLimit') perProductLimit?: string,
  ) {
    const ids = (productIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const limitNum = perProductLimit !== undefined ? Number(perProductLimit) : 100;
    return this.billingService.productPurchases(
      customerId,
      ids,
      req.user.branchId,
      Number.isFinite(limitNum) ? limitNum : 100,
    );
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Get specific invoice by ID with items' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.billingService.findOne(id, req.user.branchId);
  }

  @Patch(':id/convert')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Convert a quotation to an invoice' })
  convertToInvoice(@Param('id') id: string, @Request() req: any) {
    return this.billingService.convertToInvoice(id, req.user.branchId);
  }

  @Patch(':id/save-draft')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Re-save a draft invoice without finalizing (no stock / ledger changes).' })
  saveDraft(@Param('id') id: string, @Body() dto: CreateInvoiceDto, @Request() req: any) {
    return this.billingService.saveDraft(id, dto, req.user.branchId);
  }

  @Patch(':id/finalize')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Finalize a draft invoice (deducts stock, updates ledger).' })
  finalizeDraft(@Param('id') id: string, @Body() dto: CreateInvoiceDto, @Request() req: any) {
    return this.billingService.finalizeDraft(id, dto, req.user.branchId);
  }

  @Patch(':id/edit-invoice')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Edit an UNPAID or PARTIAL invoice (reverses old stock/ledger and re-applies).' })
  editInvoice(@Param('id') id: string, @Body() dto: CreateInvoiceDto, @Request() req: any) {
    return this.billingService.editUnpaidInvoice(id, dto, req.user.userId, req.user.branchId);
  }

  @Patch(':id/collect-payment')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Collect payment against a credit/partial invoice' })
  collectPayment(
    @Param('id') id: string,
    @Body('amountReceived') amountReceived: number,
    @Body('paymentMode') paymentMode: string,
    @Request() req: any,
  ) {
    return this.billingService.collectPayment(id, Number(amountReceived), paymentMode, req.user.branchId);
  }

  @Post(':id/send-whatsapp')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Re-queue invoice PDF + payment QR for WhatsApp delivery' })
  sendWhatsApp(@Param('id') id: string) {
    return this.billingService.emitInvoiceCreatedById(id);
  }

  @Post(':id/payment-link')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Generate / regenerate a UPI payment QR for the invoice outstanding' })
  createPaymentLink(@Param('id') id: string) {
    return this.paymentsService.createPaymentLinkForInvoice(id);
  }

  @Post(':id/reconcile-payment-link')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary:
      'Poll payment gateway for any payments captured against this invoice and apply them (used when a webhook was missed)',
  })
  async reconcilePaymentLink(@Param('id') id: string) {
    const results = await this.paymentsService.pollPaymentsForInvoice(id);
    const applied: any[] = [];
    for (const { link, payments } of results) {
      for (const p of payments) {
        if (p.status !== 'captured') continue;
        const r = await this.reconciliation.handleQrCredited({
          providerQrId: link.providerQrId,
          providerPaymentId: p.providerPaymentId,
          amount: p.amount,
          invoiceIdFromNotes: link.invoiceId,
          paidAtUnix: p.capturedAt ? Math.floor(p.capturedAt.getTime() / 1000) : null,
        });
        applied.push(r);
      }
    }
    return { ok: true, applied };
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Update invoice fields (e.g. cancel)' })
  update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.billingService.update(id, body, req.user.branchId);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Delete a quotation or cancelled invoice' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.billingService.remove(id, req.user.branchId);
  }

  @Get('export/tally-xml')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Export invoices as Tally-compatible XML' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  async exportTally(
    @Request() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId: string,
    @Res() res: Response,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    const xml = await this.billingService.exportTallyXml(from, to, effectiveBranchId);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'attachment; filename="tally-export.xml"');
    res.send(xml);
  }

  @Get('export/csv')
  @Roles('ADMIN', 'ACCOUNTANT', 'PHARMACIST')
  @ApiOperation({ summary: 'Export invoices as CSV' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  async exportCsv(
    @Request() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId: string,
    @Res() res: Response,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    const csv = await this.billingService.exportCsv(from, to, effectiveBranchId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices-export.csv"');
    res.send(csv);
  }
}
