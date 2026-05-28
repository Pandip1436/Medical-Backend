import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('audit-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List audit log entries (admin only)' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'module', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'ISO date — inclusive lower bound on createdAt' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'ISO date — inclusive upper bound on createdAt' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  findAll(
    @Query('q') q?: string,
    @Query('userId') userId?: string,
    @Query('module') module?: string,
    @Query('action') action?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.auditLogsService.findAll({
      query: q,
      userId,
      module,
      action,
      dateFrom,
      dateTo,
      skip: skip !== undefined ? parseInt(skip, 10) : undefined,
      take: take !== undefined ? parseInt(take, 10) : undefined,
    });
  }

  @Get('stats')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Aggregate counts for audit-trail summary tiles' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'module', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  stats(
    @Query('q') q?: string,
    @Query('userId') userId?: string,
    @Query('module') module?: string,
    @Query('action') action?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.auditLogsService.stats({
      query: q,
      userId,
      module,
      action,
      dateFrom,
      dateTo,
    });
  }
}
