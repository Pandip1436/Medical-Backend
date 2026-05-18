import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { LeadsAnalyticsService } from './leads-analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

// Read-only analytics endpoints for the CRM Leads page. Three routes split so
// the page can lazy-load each panel and refresh them independently.
@ApiTags('leads-analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/leads/analytics')
export class LeadsAnalyticsController {
  constructor(private readonly svc: LeadsAnalyticsService) {}

  @Get('summary')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({
    summary:
      'KPIs + funnel + source breakdown + aging + top cities for the period',
  })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'branchId', required: false })
  getSummary(
    @Request() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.svc.getSummary({ from, to, branchId: effectiveBranchId });
  }

  @Get('trend')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Time series of created + won leads per bucket' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'bucket', required: false, enum: ['day', 'month'] })
  @ApiQuery({ name: 'branchId', required: false })
  getTrend(
    @Request() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('bucket') bucket?: 'day' | 'month',
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.svc.getTrend({
      from,
      to,
      bucket,
      branchId: effectiveBranchId,
    });
  }

  @Get('needs-attention')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({
    summary: 'Open leads with no activity in N days, highest value first',
  })
  @ApiQuery({ name: 'staleDays', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'branchId', required: false })
  getNeedsAttention(
    @Request() req: AuthenticatedRequest,
    @Query('staleDays') staleDays?: string,
    @Query('limit') limit?: string,
    @Query('branchId') branchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
    return this.svc.getNeedsAttention({
      branchId: effectiveBranchId,
      staleDays: staleDays ? Number(staleDays) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
