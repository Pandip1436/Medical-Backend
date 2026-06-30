import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, UseInterceptors, UploadedFile, BadRequestException, Request } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AdjustStockDto, BulkAdjustStockDto } from './dto/adjust-stock.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { resolveBranchScope } from '../common/branch-scope.util';

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('import-csv')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Bulk import products from a CSV file' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  importCsv(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
    @Query('branchId') branchId?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!file.originalname.endsWith('.csv') && file.mimetype !== 'text/csv') {
      throw new BadRequestException('Only CSV files are accepted');
    }
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.productsService.importCsv(file.buffer, effectiveBranchId);
  }

  @Post()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Create a new product' })
  create(
    @Body() createProductDto: CreateProductDto,
    @Request() req: any,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.productsService.create({ ...createProductDto, branchId: effectiveBranchId });
  }

  @Post('bulk')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Bulk create products from JSON' })
  bulkCreate(
    @Body() products: any[],
    @Request() req: any,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.productsService.bulkCreate(products, effectiveBranchId);
  }

  @Post('bulk-hsn')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Bulk update products HSN and GST from JSON' })
  bulkUpdateHsn(
    @Body() items: any[],
    @Request() req: any,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId;
    return this.productsService.bulkUpdateHsn(items, effectiveBranchId);
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Get all products for a branch (paginated when skip/take provided)' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'schedule', required: false })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({ name: 'take', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'status', required: false })
  findAll(
    @Request() req: any,
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('schedule') schedule?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
  ) {
    const effectiveBranchId = resolveBranchScope(req.user);
    return this.productsService.findAll({
      query: q,
      categoryId,
      schedule,
      status,
      skip: skip !== undefined ? Number(skip) : undefined,
      take: take !== undefined ? Number(take) : undefined,
      branchId: effectiveBranchId,
    });
  }

  // Bulk export — every product matching the active filters + all
  // categories. Powers the Export → edit → Re-import workflow.
  @Get('export')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({
    summary:
      'Bulk export — every product matching the active filters plus the full category list. Round-trip compatible with the product import flow.',
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'schedule', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'inactive'],
  })
  exportProducts(
    @Request() req: any,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('schedule') schedule?: string,
    @Query('status') status?: string,
  ) {
    const effectiveBranchId = resolveBranchScope(req.user);
    return this.productsService.exportData(effectiveBranchId, {
      query: q?.trim() || undefined,
      categoryId: categoryId || undefined,
      schedule: schedule || undefined,
      status: status === 'active' || status === 'inactive' ? status : undefined,
    });
  }

  @Get('disposals')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'List historical write-offs / disposals from the stock-adjustment log, filtered by reason, paginated' })
  @ApiQuery({ name: 'reason', required: true, enum: ['Expired Removal', 'Damaged'] })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({ name: 'take', required: false })
  listDisposals(
    @Request() req: any,
    @Query('reason') reason: 'Expired Removal' | 'Damaged',
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.productsService.listDisposals(req.user.branchId, reason, {
      skip: skip !== undefined ? Number(skip) : undefined,
      take: take !== undefined ? Number(take) : undefined,
    });
  }

  @Get('adjustments')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({ summary: 'List historical stock adjustments grouped by adjustment number, paginated' })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({ name: 'take', required: false })
  listAdjustments(
    @Request() req: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.productsService.listAdjustments(req.user.branchId, {
      skip: skip !== undefined ? Number(skip) : undefined,
      take: take !== undefined ? Number(take) : undefined,
    });
  }

  @Get(':id/history')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Get full sales and purchase history for a product' })
  @ApiQuery({ name: 'skip', required: false })
  @ApiQuery({ name: 'take', required: false })
  getHistory(
    @Param('id') id: string,
    @Request() req: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.productsService.getProductHistory(id, req.user.branchId, {
      skip: skip !== undefined ? Number(skip) : undefined,
      take: take !== undefined ? Number(take) : undefined,
    });
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'SALESPERSON')
  @ApiOperation({ summary: 'Get product details by ID including batches' })
  findOne(@Param('id') id: string, @Request() req: any) {
    return this.productsService.findOne(id, req.user.branchId);
  }

  @Patch(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Update a product' })
  update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto, @Request() req: any) {
    return this.productsService.update(id, updateProductDto, req.user.branchId);
  }

  @Post('bulk-adjust')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Submit a stock adjustment for multiple batches; queues approval if total impact exceeds threshold for non-admin users' })
  bulkAdjust(
    @Body() body: BulkAdjustStockDto,
    @Request() req: any,
  ) {
    const user = {
      userId: req.user.userId,
      name: req.user.name ?? req.user.email ?? 'Unknown',
      role: req.user.role,
    };
    return this.productsService.submitBulkAdjustment(body.items, req.user.branchId, user);
  }

  @Patch(':id/batches/:batchId/adjust')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Adjust stock for a specific batch; queues approval for non-admin if value exceeds threshold' })
  adjust(
    @Param('id') id: string,
    @Param('batchId') batchId: string,
    @Body() body: AdjustStockDto,
    @Request() req: any,
  ) {
    const user = {
      userId: req.user.userId,
      name: req.user.name ?? req.user.email ?? 'Unknown',
      role: req.user.role,
    };
    return this.productsService.submitBulkAdjustment(
      [{ productId: id, batchId, adjustedQty: body.adjustedQty, reason: body.reason }],
      req.user.branchId,
      user,
    );
  }

  @Patch(':id/toggle-active')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Toggle product active/inactive status (soft delete)' })
  toggleActive(@Param('id') id: string, @Request() req: any) {
    return this.productsService.toggleActive(id, req.user.branchId);
  }

  @Get(':id/adjustment-logs')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Get stock adjustment audit trail for a product' })
  getAdjustmentLogs(@Param('id') id: string) {
    return (this.productsService['prisma'] as any).stockAdjustmentLog.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a product (Admin only)' })
  remove(@Param('id') id: string, @Request() req: any) {
    return this.productsService.remove(id, req.user.branchId);
  }
}
