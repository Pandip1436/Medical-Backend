import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
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
  create(@Body() createCustomerDto: CreateCustomerDto) {
    return this.customersService.create(createCustomerDto);
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get all customers or search by name/phone' })
  @ApiQuery({ name: 'q', required: false, description: 'Search term' })
  findAll(@Query('q') q?: string) {
    return this.customersService.findAll(q);
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get customer details including prescriptions and recent invoices' })
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Update customer details' })
  update(@Param('id') id: string, @Body() updateCustomerDto: UpdateCustomerDto) {
    return this.customersService.update(id, updateCustomerDto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a customer (Admin only)' })
  remove(@Param('id') id: string) {
    return this.customersService.remove(id);
  }
}
