import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Create a new product master record' })
  create(@Body() createProductDto: CreateProductDto) {
    return this.productsService.create(createProductDto);
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get all products or search by term' })
  @ApiQuery({ name: 'q', required: false, description: 'Search term for name or barcode' })
  findAll(@Query('q') q?: string) {
    return this.productsService.findAll(q);
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Get product details by ID including batches' })
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Update a product (Admin/Inventory Manager only)' })
  update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
    return this.productsService.update(id, updateProductDto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a product (Admin only)' })
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
