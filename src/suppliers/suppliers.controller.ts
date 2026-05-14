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
    };

    return this.suppliersService.findAll(
      q,
      effectiveBranchId,
      Number.isFinite(skipNum) ? skipNum : undefined,
      Number.isFinite(takeNum) ? takeNum : undefined,
      filters,
    );
  }

  @Get(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get supplier details including basic history' })
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.suppliersService.findOne(id, req.user.branchId ?? undefined);
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

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a supplier (Admin only)' })
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.suppliersService.remove(id, req.user.branchId ?? undefined);
  }
}
