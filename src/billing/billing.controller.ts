import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
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
    return this.billingService.create(createInvoiceDto, req.user.userId);
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get all invoices or search' })
  @ApiQuery({ name: 'q', required: false, description: 'Search invoice term' })
  findAll(@Query('q') q?: string) {
    return this.billingService.findAll(q);
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get specific invoice by ID with items' })
  findOne(@Param('id') id: string) {
    return this.billingService.findOne(id);
  }
}
