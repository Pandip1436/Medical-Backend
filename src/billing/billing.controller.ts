import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BillingService } from './billing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post()
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Create a new invoice transaction' })
  create(@Body() createInvoiceDto: CreateInvoiceDto, @Request() req: any) {
    const effectiveBranchId = req.user.branchId ?? createInvoiceDto.branchId;
    return this.billingService.create(createInvoiceDto, req.user.userId, effectiveBranchId);
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Get all invoices or search' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'type', required: false, description: 'INVOICE or QUOTATION' })
  findAll(
    @Request() req: any,
    @Query('q') q?: string,
    @Query('customerId') customerId?: string,
    @Query('branchId') branchId?: string,
    @Query('type') type?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.billingService.findAll(q, customerId, effectiveBranchId, type);
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
