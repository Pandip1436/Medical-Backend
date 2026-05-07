import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Patch,
  Delete,
} from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
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

@ApiTags('purchase-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly poService: PurchaseOrdersService) {}

  @Post()
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Create a new Purchase Order' })
  create(
    @Body() createPurchaseOrderDto: CreatePurchaseOrderDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.poService.create(
      createPurchaseOrderDto,
      req.user.userId,
      effectiveBranchId,
    );
  }

  @Get()
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary: 'List all Purchase Orders or search (paginated when ?page is set)',
  })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Search term for PO number or supplier',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (1-indexed). Omit for full list.',
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    description: 'Page size (default 20, max 200)',
  })
  findAll(
    @Request() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    const pageNum = page ? Number(page) : undefined;
    const pageSizeNum = pageSize ? Number(pageSize) : undefined;
    return this.poService.findAll(q, effectiveBranchId, pageNum, pageSizeNum);
  }

  @Get(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get specific Purchase Order details' })
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.poService.findOne(id, req.user.branchId ?? undefined);
  }

  @Patch(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Update a Purchase Order' })
  update(
    @Param('id') id: string,
    @Body() updatePurchaseOrderDto: UpdatePurchaseOrderDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.poService.update(
      id,
      updatePurchaseOrderDto,
      req.user.branchId ?? undefined,
    );
  }

  @Delete(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Delete a Purchase Order' })
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.poService.remove(id, req.user.branchId ?? undefined);
  }
}
