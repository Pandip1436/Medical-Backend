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
    // If user has a fixed branch (branch-specific role), use it.
    // Otherwise, use the branchId from the request body or query param.
    const effectiveBranchId =
      req.user.branchId ?? createSupplierDto.branchId ?? qBranchId ?? undefined;

    return this.suppliersService.create({
      ...createSupplierDto,
      branchId: effectiveBranchId,
    });
  }

  @Get()
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({
    summary: 'Get all suppliers for a branch or search by name/gstin',
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  findAll(
    @Request() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.suppliersService.findAll(q, effectiveBranchId);
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
