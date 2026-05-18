import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  LeadSource,
  LeadStage,
} from '@prisma/client';
import { LeadsService, type LeadTab } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { ImportLeadsDto } from './dto/import-leads.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

const VALID_TABS: ReadonlyArray<LeadTab> = [
  'all',
  'open',
  'closed',
  'untouched',
  'lead',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
];

@ApiTags('leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({
    summary: 'List leads (paginated) + tab counts in one shot',
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'tab', required: false })
  @ApiQuery({ name: 'stage', required: false, isArray: true })
  @ApiQuery({ name: 'source', required: false, isArray: true })
  @ApiQuery({ name: 'assignedToUserId', required: false })
  @ApiQuery({ name: 'createdFrom', required: false })
  @ApiQuery({ name: 'createdTo', required: false })
  @ApiQuery({ name: 'updatedFrom', required: false })
  @ApiQuery({ name: 'updatedTo', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({
    name: 'sortDir',
    required: false,
    enum: ['asc', 'desc'],
  })
  findAll(
    @Request() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('tab') tab?: string,
    @Query('stage') stageRaw?: string | string[],
    @Query('source') sourceRaw?: string | string[],
    @Query('assignedToUserId') assignedToUserId?: string,
    @Query('branchId') qBranchId?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
    @Query('updatedFrom') updatedFrom?: string,
    @Query('updatedTo') updatedTo?: string,
    @Query('page') page?: string,
    @Query('take') take?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: 'asc' | 'desc',
  ) {
    return this.leadsService.findAll({
      q,
      tab: VALID_TABS.includes(tab as LeadTab) ? (tab as LeadTab) : undefined,
      stage: toEnumArray<LeadStage>(stageRaw, LeadStage),
      source: toEnumArray<LeadSource>(sourceRaw, LeadSource),
      assignedToUserId,
      branchId: req.user.branchId ?? qBranchId ?? undefined,
      createdFrom,
      createdTo,
      updatedFrom,
      updatedTo,
      page: page ? Number(page) : undefined,
      take: take ? Number(take) : undefined,
      sortBy,
      sortDir,
    });
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.leadsService.findOne(id, req.user.branchId ?? undefined);
  }

  @Post()
  @Roles('ADMIN', 'PHARMACIST', 'SALESPERSON')
  @ApiOperation({ summary: 'Create a new lead (optionally with new contact)' })
  create(
    @Body() dto: CreateLeadDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    const branchId = req.user.branchId ?? qBranchId;
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.leadsService.create(dto, {
      branchId,
      userId: req.user.userId,
    });
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST', 'SALESPERSON')
  @ApiOperation({
    summary:
      'Update a lead (inline stage/source/owner from the table + drawer edits)',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.leadsService.update(id, dto, req.user.branchId ?? undefined);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PHARMACIST')
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.leadsService.remove(id, req.user.branchId ?? undefined);
  }

  @Post('bulk-update')
  @Roles('ADMIN', 'PHARMACIST')
  bulkUpdate(
    @Body() body: { ids: string[]; patch: UpdateLeadDto },
    @Request() req: AuthenticatedRequest,
  ) {
    if (!Array.isArray(body?.ids)) {
      throw new BadRequestException('ids[] required');
    }
    return this.leadsService.bulkUpdate(
      body.ids,
      body.patch ?? {},
      req.user.branchId ?? undefined,
    );
  }

  @Post('bulk-delete')
  @Roles('ADMIN')
  bulkDelete(
    @Body() body: { ids: string[] },
    @Request() req: AuthenticatedRequest,
  ) {
    if (!Array.isArray(body?.ids)) {
      throw new BadRequestException('ids[] required');
    }
    return this.leadsService.bulkDelete(
      body.ids,
      req.user.branchId ?? undefined,
    );
  }

  @Get('export')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({
    summary:
      'Bulk export — same filters as GET /leads, no pagination, capped at 50,000 rows',
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'tab', required: false })
  @ApiQuery({ name: 'stage', required: false, isArray: true })
  @ApiQuery({ name: 'source', required: false, isArray: true })
  @ApiQuery({ name: 'assignedToUserId', required: false })
  @ApiQuery({ name: 'createdFrom', required: false })
  @ApiQuery({ name: 'createdTo', required: false })
  @ApiQuery({ name: 'updatedFrom', required: false })
  @ApiQuery({ name: 'updatedTo', required: false })
  @ApiQuery({
    name: 'ids',
    required: false,
    description: 'Comma-separated lead ids — when present, filter params are ignored',
  })
  exportLeads(
    @Request() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('tab') tab?: string,
    @Query('stage') stageRaw?: string | string[],
    @Query('source') sourceRaw?: string | string[],
    @Query('assignedToUserId') assignedToUserId?: string,
    @Query('branchId') qBranchId?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
    @Query('updatedFrom') updatedFrom?: string,
    @Query('updatedTo') updatedTo?: string,
    @Query('ids') ids?: string,
  ) {
    const idArr = ids
      ? ids.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
      : undefined;
    return this.leadsService.export({
      q,
      tab: VALID_TABS.includes(tab as LeadTab) ? (tab as LeadTab) : undefined,
      stage: toEnumArray<LeadStage>(stageRaw, LeadStage),
      source: toEnumArray<LeadSource>(sourceRaw, LeadSource),
      assignedToUserId,
      branchId: req.user.branchId ?? qBranchId ?? undefined,
      createdFrom,
      createdTo,
      updatedFrom,
      updatedTo,
      ids: idArr,
    });
  }

  @Post('import')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({
    summary:
      'Bulk import leads from a pre-mapped payload (CSV → JSON happens on the client)',
  })
  importLeads(
    @Body() dto: ImportLeadsDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    const branchId = req.user.branchId ?? qBranchId;
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.leadsService.importLeads(dto, {
      branchId,
      userId: req.user.userId,
    });
  }

  @Get(':id/quotations')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Quotations linked to this lead' })
  findQuotations(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.leadsService.findQuotations(id, req.user.branchId ?? undefined);
  }

  @Get(':id/invoices')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Invoices linked to this lead' })
  findInvoices(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.leadsService.findInvoices(id, req.user.branchId ?? undefined);
  }
}

// Parses repeated query params (?stage=LEAD&stage=QUALIFIED) and comma-separated
// values (?stage=LEAD,QUALIFIED) into a typed enum array. Unknown values dropped.
function toEnumArray<T extends string>(
  raw: string | string[] | undefined,
  enumObj: Record<string, string>,
): T[] | undefined {
  if (raw === undefined) return undefined;
  const arr = Array.isArray(raw) ? raw : raw.split(',');
  const valid = new Set(Object.values(enumObj));
  const out = arr
    .map((s) => s.trim())
    .filter((s) => valid.has(s)) as T[];
  return out.length > 0 ? out : undefined;
}
