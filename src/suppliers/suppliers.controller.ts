import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('suppliers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Create a new supplier' })
  create(@Body() createSupplierDto: CreateSupplierDto) {
    return this.suppliersService.create(createSupplierDto);
  }

  @Get()
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get all suppliers or search by name/gstin' })
  @ApiQuery({ name: 'q', required: false, description: 'Search term for name or GSTIN' })
  findAll(@Query('q') q?: string) {
    return this.suppliersService.findAll(q);
  }

  @Get(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get supplier details including basic history' })
  findOne(@Param('id') id: string) {
    return this.suppliersService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Update a supplier' })
  update(@Param('id') id: string, @Body() updateSupplierDto: UpdateSupplierDto) {
    return this.suppliersService.update(id, updateSupplierDto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a supplier (Admin only)' })
  remove(@Param('id') id: string) {
    return this.suppliersService.remove(id);
  }
}
