import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, Patch, Delete } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('purchase-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly poService: PurchaseOrdersService) { }

  @Post()
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Create a new Purchase Order' })
  create(@Body() createPurchaseOrderDto: CreatePurchaseOrderDto, @Request() req: any, @Query('branchId') branchId?: string) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.poService.create(createPurchaseOrderDto, req.user.userId, effectiveBranchId);
  }

  @Get()
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'List all Purchase Orders or search' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'q', required: false, description: 'Search term for PO number or supplier' })
  findAll(@Request() req: any, @Query('q') q?: string, @Query('branchId') branchId?: string) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.poService.findAll(q, effectiveBranchId);
  }

  @Get(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get specific Purchase Order details' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.poService.findOne(id, req.user.branchId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Update a Purchase Order' })
  update(@Param('id') id: string, @Body() updatePurchaseOrderDto: UpdatePurchaseOrderDto, @Request() req: any) {
    return this.poService.update(id, updatePurchaseOrderDto, req.user.branchId);
  }

  @Delete(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Delete a Purchase Order' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.poService.remove(id, req.user.branchId);
  }
}
