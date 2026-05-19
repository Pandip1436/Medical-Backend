import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Create a new customer profile' })
  create(
    @Body() createCustomerDto: CreateCustomerDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.customersService.create(
      { ...createCustomerDto, branchId: effectiveBranchId },
      { userId: req.user.userId, role: req.user.role },
    );
  }

  @Post('bulk')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Bulk create customers' })
  bulkCreate(
    @Body() customers: CreateCustomerDto[],
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.customersService.bulkCreate(customers, effectiveBranchId);
  }

  @Get()
  @Roles(
    'ADMIN',
    'PHARMACIST',
    'ACCOUNTANT',
    'SALESPERSON',
    'INVENTORY_MANAGER',
  )
  @ApiOperation({
    summary: 'Get all customers for a branch or search by name/phone',
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({
    name: 'customerType',
    required: false,
    enum: ['RETAIL', 'WHOLESALE', 'DOCTOR'],
  })
  @ApiQuery({ name: 'hasOutstanding', required: false, type: Boolean })
  @ApiQuery({ name: 'hasGstin', required: false, type: Boolean })
  findAll(
    @Request() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('customerType') customerType?: 'RETAIL' | 'WHOLESALE' | 'DOCTOR',
    @Query('hasOutstanding') hasOutstanding?: string,
    @Query('hasGstin') hasGstin?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    const skipNum = skip !== undefined ? Number(skip) : undefined;
    const takeNum = take !== undefined ? Number(take) : undefined;
    return this.customersService.findAll(
      q,
      effectiveBranchId,
      Number.isFinite(skipNum) ? skipNum : undefined,
      Number.isFinite(takeNum) ? takeNum : undefined,
      {
        customerType:
          customerType === 'RETAIL' ||
          customerType === 'WHOLESALE' ||
          customerType === 'DOCTOR'
            ? customerType
            : undefined,
        hasOutstanding:
          typeof hasOutstanding === 'string'
            ? hasOutstanding === 'true'
            : undefined,
        hasGstin:
          typeof hasGstin === 'string' ? hasGstin === 'true' : undefined,
      },
    );
  }

  @Get('summary')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary: 'Global customer counts + total outstanding (for stat cards)',
  })
  summary(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.customersService.summary(effectiveBranchId);
  }

  @Get('outstanding')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary: 'Get live outstanding balances computed from invoices',
  })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({
    name: 'bucket',
    required: false,
    enum: ['current', '0-30', '31-60', '61-90', '90+'],
  })
  @ApiQuery({ name: 'minOutstanding', required: false, type: Number })
  getOutstanding(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('q') q?: string,
    @Query('bucket') bucket?: string,
    @Query('minOutstanding') minOutstanding?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    const allowedBuckets = ['current', '0-30', '31-60', '61-90', '90+'] as const;
    const safeBucket = (allowedBuckets as readonly string[]).includes(bucket ?? '')
      ? (bucket as 'current' | '0-30' | '31-60' | '61-90' | '90+')
      : undefined;
    const minNum = minOutstanding !== undefined ? Number(minOutstanding) : undefined;
    return this.customersService.getOutstanding(effectiveBranchId, {
      q: q?.trim() || undefined,
      bucket: safeBucket,
      minOutstanding: Number.isFinite(minNum) ? minNum : undefined,
    });
  }

  @Get(':id/outstanding-invoices')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary:
      "Get a single customer's open invoices (UNPAID / PARTIAL) — oldest first, with daysOverdue",
  })
  getCustomerOutstandingInvoices(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.customersService.getCustomerOutstandingInvoices(
      id,
      req.user.branchId ?? undefined,
    );
  }

  @Get(':id')
  @Roles(
    'ADMIN',
    'PHARMACIST',
    'ACCOUNTANT',
    'SALESPERSON',
    'INVENTORY_MANAGER',
  )
  @ApiOperation({
    summary: 'Get customer details including prescriptions and recent invoices',
  })
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.customersService.findOne(id, req.user.branchId ?? undefined);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Update customer details' })
  update(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.customersService.update(
      id,
      updateCustomerDto,
      req.user.branchId ?? undefined,
    );
  }

  @Post(':id/payment')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary:
      'Record a payment against customer outstanding balance. Defaults to FIFO; pass invoiceIds to apply to specific invoices only.',
  })
  recordPayment(
    @Param('id') id: string,
    @Body()
    body: {
      amount: number;
      paymentMode: string;
      referenceNumber?: string;
      invoiceIds?: string[];
    },
    @Request() req: AuthenticatedRequest,
  ) {
    return this.customersService.recordPayment(
      id,
      body.amount,
      body.paymentMode,
      body.referenceNumber,
      req.user.branchId ?? undefined,
      body.invoiceIds,
    );
  }

  @Get(':id/payments')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get payment history for a customer' })
  getPaymentHistory(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.customersService.getPaymentHistory(
      id,
      req.user.branchId ?? undefined,
    );
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a customer (Admin only)' })
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.customersService.remove(id, req.user.branchId ?? undefined);
  }
}
