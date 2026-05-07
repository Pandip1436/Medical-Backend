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
  findAll(
    @Request() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.customersService.findAll(q, effectiveBranchId);
  }

  @Get('outstanding')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary: 'Get live outstanding balances computed from invoices',
  })
  getOutstanding(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.customersService.getOutstanding(effectiveBranchId);
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
      'Record a payment against customer outstanding balance (FIFO allocation)',
  })
  recordPayment(
    @Param('id') id: string,
    @Body()
    body: { amount: number; paymentMode: string; referenceNumber?: string },
    @Request() req: AuthenticatedRequest,
  ) {
    return this.customersService.recordPayment(
      id,
      body.amount,
      body.paymentMode,
      body.referenceNumber,
      req.user.branchId ?? undefined,
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
