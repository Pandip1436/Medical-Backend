import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { GrnService } from './grn.service';
import { CreateGrnDto } from './dto/create-grn.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('grn')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/grn')
export class GrnController {
  constructor(private readonly grnService: GrnService) {}

  @Post()
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({
    summary: 'Create a new Goods Receipt Note and spawn batches',
  })
  create(
    @Body() createGrnDto: CreateGrnDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.grnService.create(createGrnDto, effectiveBranchId);
  }

  @Get()
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary: 'List all GRNs or search (paginated when ?page is set)',
  })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Search term for GRN number or supplier',
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
    return this.grnService.findAll(q, effectiveBranchId, pageNum, pageSizeNum);
  }

  @Get('admin/backfill-po-qty')
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Backfill PO receivedQty from existing GRNs (run once after migration)',
  })
  backfill() {
    return this.grnService.backfillPoReceivedQty();
  }

  @Get('admin/backfill-grn-ordered-qty')
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Backfill GRN orderedQty so supplementary GRNs reflect remaining qty at that delivery',
  })
  backfillGrnOrdered() {
    return this.grnService.backfillGrnOrderedQty();
  }

  @Get('admin/backfill-supplier-outstanding')
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Backfill supplier currentOutstanding from existing GRNs and ADJUST debit notes',
  })
  backfillSupplierOutstanding() {
    return this.grnService.backfillSupplierOutstanding();
  }

  @Get('admin/backfill-po-status-with-debit-notes')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Recompute PO status including short-delivery debit notes',
  })
  backfillPoStatusDN() {
    return this.grnService.backfillPoStatusWithDebitNotes();
  }

  @Get('admin/reverse-short-delivery-stock')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Reverse wrongly-deducted stock for short-delivery debit notes',
  })
  reverseShortDeliveryStock() {
    return this.grnService.reverseShortDeliveryStockDeduction();
  }

  @Get(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get specific GRN details' })
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.grnService.findOne(id, req.user.branchId ?? undefined);
  }
}
