import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

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
    @Request() req: any,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.customersService.create({ ...createCustomerDto, branchId: effectiveBranchId });
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Get all customers for a branch or search by name/phone' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  findAll(
    @Request() req: any,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.customersService.findAll(q, effectiveBranchId);
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Get customer details including prescriptions and recent invoices' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.customersService.findOne(id, req.user.branchId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Update customer details' })
  update(@Param('id') id: string, @Body() updateCustomerDto: UpdateCustomerDto, @Request() req: any) {
    return this.customersService.update(id, updateCustomerDto, req.user.branchId);
  }

  @Post(':id/payment')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Record a payment against customer outstanding balance' })
  recordPayment(
    @Param('id') id: string,
    @Body() body: { amount: number; paymentMode: string; referenceNumber?: string },
    @Request() req: any,
  ) {
    return this.customersService.recordPayment(id, body.amount, body.paymentMode, body.referenceNumber, req.user.branchId);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a customer (Admin only)' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.customersService.remove(id, req.user.branchId);
  }
}
