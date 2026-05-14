import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { SupplierActivityType } from '@prisma/client';
import { SupplierActivitiesService } from './supplier-activities.service';
import { CreateSupplierActivityDto } from './dto/create-supplier-activity.dto';
import { UpdateSupplierActivityDto } from './dto/update-supplier-activity.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('supplier-activities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/suppliers/:supplierId/activities')
export class SupplierActivitiesController {
  constructor(
    private readonly activitiesService: SupplierActivitiesService,
  ) {}

  @Get()
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'List supplier activities' })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'branchId', required: false })
  findAll(
    @Param('supplierId') supplierId: string,
    @Request() req: AuthenticatedRequest,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('branchId') qBranchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? qBranchId ?? undefined;
    const skipNum = skip !== undefined ? Number(skip) : undefined;
    const takeNum = take !== undefined ? Number(take) : undefined;
    const typed =
      type && (Object.values(SupplierActivityType) as string[]).includes(type)
        ? (type as SupplierActivityType)
        : undefined;
    return this.activitiesService.findAll(supplierId, effectiveBranchId, {
      type: typed,
      from,
      to,
      skip: Number.isFinite(skipNum) ? skipNum : undefined,
      take: Number.isFinite(takeNum) ? takeNum : undefined,
    });
  }

  @Post()
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Log an activity against a supplier' })
  create(
    @Param('supplierId') supplierId: string,
    @Body() dto: CreateSupplierActivityDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? qBranchId ?? undefined;
    return this.activitiesService.create(supplierId, dto, {
      userId: req.user.userId,
      branchId: effectiveBranchId,
    });
  }

  @Patch(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Update an activity (commonly to flip reminder status)' })
  update(
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierActivityDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.activitiesService.update(
      supplierId,
      id,
      dto,
      req.user.branchId ?? undefined,
    );
  }

  @Delete(':id')
  @Roles('ADMIN', 'INVENTORY_MANAGER')
  @ApiOperation({ summary: 'Delete an activity' })
  remove(
    @Param('supplierId') supplierId: string,
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.activitiesService.remove(
      supplierId,
      id,
      req.user.branchId ?? undefined,
    );
  }
}
