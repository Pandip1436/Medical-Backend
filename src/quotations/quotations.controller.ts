import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
  Delete,
  Request,
  UseGuards,
} from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/quotations')
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Post()
  @Roles('ADMIN', 'PHARMACIST')
  create(
    @Body() dto: CreateQuotationDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.quotationsService.create(dto, effectiveBranchId);
  }

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  findAll(
    @Request() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('status') status?: string,
    @Query('amountMin') amountMin?: number,
    @Query('amountMax') amountMax?: number,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.quotationsService.findAll({
      q,
      fromDate,
      toDate,
      status,
      amountMin,
      amountMax,
      branchId: effectiveBranchId,
    });
  }

  @Get('stats')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  getStats(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.quotationsService.getStats(effectiveBranchId);
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT')
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.quotationsService.findOne(id, req.user.branchId ?? undefined);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST')
  update(
    @Param('id') id: string,
    @Body() data: Record<string, unknown>,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.quotationsService.update(id, data, req.user.branchId ?? undefined);
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'PHARMACIST')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.quotationsService.updateStatus(
      id,
      status,
      req.user.branchId ?? undefined,
    );
  }

  @Delete(':id')
  @Roles('ADMIN', 'PHARMACIST')
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.quotationsService.remove(id, req.user.branchId ?? undefined);
  }
}
