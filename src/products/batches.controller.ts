import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { resolveBranchScope } from '../common/branch-scope.util';
import { ProductsService } from './products.service';

@ApiTags('batches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/batches')
export class BatchesController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'List batches with optional filters and pagination' })
  @ApiQuery({ name: 'q', required: false, description: 'Search by batch number or product name' })
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiQuery({ name: 'expiringWithin', required: false, description: 'Days; only batches not yet expired and expiring within N days' })
  @ApiQuery({ name: 'expired', required: false, description: 'true → only already-expired batches' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'expired', 'out_of_stock', 'all'] })
  @ApiQuery({ name: 'hasStock', required: false, description: 'true → only batches with quantity > 0, independent of expiry' })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({ name: 'take', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  findAll(
    @Request() req: any,
    @Query('q') q?: string,
    @Query('productId') productId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('expiringWithin') expiringWithin?: string,
    @Query('expired') expired?: string,
    @Query('status') status?: 'active' | 'expired' | 'out_of_stock' | 'all',
    @Query('stockStatus') stockStatus?: 'low_stock' | 'healthy',
    @Query('hasStock') hasStock?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = resolveBranchScope(req.user);
    return this.productsService.findBatches({
      query: q,
      productId,
      supplierId,
      categoryId: categoryId?.trim() || undefined,
      expiringWithin: expiringWithin !== undefined ? Number(expiringWithin) : undefined,
      expired: expired === 'true' ? true : expired === 'false' ? false : undefined,
      status,
      stockStatus,
      hasStock: hasStock === 'true' ? true : hasStock === 'false' ? false : undefined,
      skip: skip !== undefined ? Number(skip) : undefined,
      take: take !== undefined ? Number(take) : undefined,
      branchId: effectiveBranchId,
    });
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Single batch with joined product + supplier' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.productsService.findOneBatch(id, req.user.branchId);
  }
}
