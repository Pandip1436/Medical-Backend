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
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
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

@ApiTags('suppliers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Create a new supplier' })
  create(
    @Body() createSupplierDto: CreateSupplierDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    // Suppliers are per-branch master data: HQ's "Sun Pharma" and BR1's
    // "Sun Pharma" are separate records so each branch's history and
    // outstanding stay isolated. Pin new suppliers to the caller's branch.
    const effectiveBranchId =
      req.user.branchId ?? createSupplierDto.branchId ?? qBranchId ?? undefined;

    return this.suppliersService.create({
      ...createSupplierDto,
      branchId: effectiveBranchId,
    });
  }

  @Post('bulk')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Bulk create suppliers' })
  bulkCreate(
    @Body() suppliers: CreateSupplierDto[],
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? qBranchId ?? undefined;
    return this.suppliersService.bulkCreate(suppliers, effectiveBranchId);
  }

  @Get()
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary: 'Get all suppliers for a branch or search by name/gstin',
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'paymentTerms', required: false })
  @ApiQuery({ name: 'hasGstin', required: false, type: Boolean })
  @ApiQuery({ name: 'outstandingMin', required: false, type: Number })
  @ApiQuery({ name: 'outstandingMax', required: false, type: Number })
  @ApiQuery({ name: 'paymentStatus', required: false, enum: ['PAID', 'PARTIAL', 'UNPAID'] })
  findAll(
    @Request() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('isActive') isActive?: string,
    @Query('paymentTerms') paymentTerms?: string,
    @Query('hasGstin') hasGstin?: string,
    @Query('outstandingMin') outstandingMin?: string,
    @Query('outstandingMax') outstandingMax?: string,
    @Query('paymentStatus') paymentStatus?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    const skipNum = skip !== undefined ? Number(skip) : undefined;
    const takeNum = take !== undefined ? Number(take) : undefined;

    const parseBool = (v?: string): boolean | undefined =>
      v === 'true' ? true : v === 'false' ? false : undefined;
    const parseNum = (v?: string): number | undefined => {
      if (v === undefined || v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };

    const filters = {
      isActive: parseBool(isActive),
      paymentTerms: paymentTerms && paymentTerms !== 'all' ? paymentTerms : undefined,
      hasGstin: parseBool(hasGstin),
      outstandingMin: parseNum(outstandingMin),
      outstandingMax: parseNum(outstandingMax),
      paymentStatus:
        paymentStatus === 'PAID' ||
        paymentStatus === 'PARTIAL' ||
        paymentStatus === 'UNPAID'
          ? (paymentStatus as 'PAID' | 'PARTIAL' | 'UNPAID')
          : undefined,
    };

    return this.suppliersService.findAll(
      q,
      effectiveBranchId,
      Number.isFinite(skipNum) ? skipNum : undefined,
      Number.isFinite(takeNum) ? takeNum : undefined,
      filters,
    );
  }

  // Bulk export — every supplier matching the active filters plus full
  // history. Powers the Export → edit → Re-import workflow.
  @Get('export')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  @ApiOperation({
    summary:
      'Bulk export — every supplier matching the active filters plus full history (POs, GRNs, debit notes, activities, batches). Round-trip compatible with the supplier import flow.',
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'paymentTerms', required: false })
  @ApiQuery({ name: 'hasGstin', required: false, type: Boolean })
  @ApiQuery({ name: 'outstandingMin', required: false, type: Number })
  @ApiQuery({ name: 'outstandingMax', required: false, type: Number })
  exportData(
    @Request() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
    @Query('isActive') isActive?: string,
    @Query('paymentTerms') paymentTerms?: string,
    @Query('hasGstin') hasGstin?: string,
    @Query('outstandingMin') outstandingMin?: string,
    @Query('outstandingMax') outstandingMax?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    const minNum =
      outstandingMin !== undefined ? Number(outstandingMin) : undefined;
    const maxNum =
      outstandingMax !== undefined ? Number(outstandingMax) : undefined;
    return this.suppliersService.exportData(effectiveBranchId, {
      q: q?.trim() || undefined,
      isActive: typeof isActive === 'string' ? isActive === 'true' : undefined,
      paymentTerms: paymentTerms || undefined,
      hasGstin: typeof hasGstin === 'string' ? hasGstin === 'true' : undefined,
      outstandingMin: Number.isFinite(minNum) ? minNum : undefined,
      outstandingMax: Number.isFinite(maxNum) ? maxNum : undefined,
    });
  }

  // NOTE: must be declared BEFORE `@Get(':id')` so "outstanding" isn't captured
  // as a supplier id by the param route.
  @Get('outstanding')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Suppliers with an unpaid balance + aging buckets' })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({
    name: 'bucket',
    required: false,
    enum: ['current', '0-30', '31-60', '61-90', '90+'],
  })
  @ApiQuery({ name: 'minOutstanding', required: false, type: Number })
  getOutstanding(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('q') q?: string,
    @Query('bucket') bucket?: string,
    @Query('minOutstanding') minOutstanding?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    const allowedBuckets = ['current', '0-30', '31-60', '61-90', '90+'] as const;
    const safeBucket = (allowedBuckets as readonly string[]).includes(bucket ?? '')
      ? (bucket as 'current' | '0-30' | '31-60' | '61-90' | '90+')
      : undefined;
    const minNum =
      minOutstanding !== undefined ? Number(minOutstanding) : undefined;
    return this.suppliersService.getOutstanding(effectiveBranchId, {
      q: q?.trim() || undefined,
      bucket: safeBucket,
      minOutstanding: Number.isFinite(minNum) ? minNum : undefined,
    });
  }

  // Declared before `@Get(':id')` so "summary" isn't captured as a supplier id.
  @Get('summary')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary:
      'Directory-wide supplier KPIs: total purchases and pending payments (for the stat cards).',
  })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'paymentTerms', required: false })
  @ApiQuery({ name: 'hasGstin', required: false, type: Boolean })
  @ApiQuery({ name: 'outstandingMin', required: false, type: Number })
  @ApiQuery({ name: 'outstandingMax', required: false, type: Number })
  getSummary(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
    @Query('q') q?: string,
    @Query('isActive') isActive?: string,
    @Query('paymentTerms') paymentTerms?: string,
    @Query('hasGstin') hasGstin?: string,
    @Query('outstandingMin') outstandingMin?: string,
    @Query('outstandingMax') outstandingMax?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    const minNum = outstandingMin !== undefined ? Number(outstandingMin) : undefined;
    const maxNum = outstandingMax !== undefined ? Number(outstandingMax) : undefined;
    return this.suppliersService.summary(effectiveBranchId, {
      q: q?.trim() || undefined,
      isActive: typeof isActive === 'string' ? isActive === 'true' : undefined,
      paymentTerms:
        paymentTerms && paymentTerms !== 'all' ? paymentTerms : undefined,
      hasGstin: typeof hasGstin === 'string' ? hasGstin === 'true' : undefined,
      outstandingMin: Number.isFinite(minNum) ? minNum : undefined,
      outstandingMax: Number.isFinite(maxNum) ? maxNum : undefined,
    });
  }

  // Declared before `@Get(':id')` so "check-duplicate" isn't captured as an id.
  @Get('check-duplicate')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({
    summary:
      'Live check whether a GSTIN / drug license is already used by another supplier in the branch (drives inline form validation).',
  })
  @ApiQuery({ name: 'gstin', required: false })
  @ApiQuery({ name: 'drugLicense', required: false })
  @ApiQuery({ name: 'excludeId', required: false })
  checkDuplicate(
    @Request() req: AuthenticatedRequest,
    @Query('gstin') gstin?: string,
    @Query('drugLicense') drugLicense?: string,
    @Query('excludeId') excludeId?: string,
  ) {
    return this.suppliersService.checkDuplicate(req.user.branchId ?? undefined, {
      gstin,
      drugLicense,
      excludeId,
    });
  }

  @Get(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get supplier details including basic history' })
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.suppliersService.findOne(id, req.user.branchId ?? undefined);
  }

  @Get(':id/outstanding-grns')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary:
      "Get a single supplier's open GRNs (UNPAID / PARTIAL) — oldest first, with daysOverdue",
  })
  getSupplierOutstandingGrns(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.suppliersService.getSupplierOutstandingGrns(
      id,
      req.user.branchId ?? undefined,
    );
  }

  @Patch(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Update a supplier' })
  update(
    @Param('id') id: string,
    @Body() updateSupplierDto: UpdateSupplierDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.suppliersService.update(
      id,
      updateSupplierDto,
      req.user.branchId ?? undefined,
    );
  }

  @Post(':id/payment')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary:
      'Record a payment against supplier outstanding. Defaults to FIFO across open GRNs; pass grnIds to apply to specific GRNs only.',
  })
  recordPayment(
    @Param('id') id: string,
    @Body()
    body: {
      amount: number;
      paymentMode: string;
      referenceNumber?: string;
      grnIds?: string[];
    },
    @Request() req: AuthenticatedRequest,
  ) {
    return this.suppliersService.recordPayment(
      id,
      Number(body.amount),
      body.paymentMode,
      body.referenceNumber,
      req.user.branchId ?? undefined,
      body.grnIds,
    );
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a supplier (Admin only)' })
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.suppliersService.remove(id, req.user.branchId ?? undefined);
  }
}
