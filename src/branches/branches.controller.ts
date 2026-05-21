import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

type AuthedRequest = { user: { role?: string } };

const STATS_ROLES = new Set(['ADMIN', 'ACCOUNTANT']);

@ApiTags('branches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a new branch/location' })
  create(@Body() dto: CreateBranchDto) {
    return this.branchesService.create(dto);
  }

  // Plain array when no skip/take provided (used by header switcher + branchStore).
  // Paginated { data, total, hasMore } with embedded stats when skip+take are provided.
  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Get branches (paginated/filterable if skip+take provided)' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'hasSales', required: false, type: Boolean })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  findAll(
    @Request() req: AuthedRequest,
    @Query('q') q?: string,
    @Query('isActive') isActive?: string,
    @Query('hasSales') hasSales?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const canSeeStats = STATS_ROLES.has(req.user?.role ?? '');
    return this.branchesService.findAll({
      q: q?.trim() || undefined,
      isActive: typeof isActive === 'string' ? isActive === 'true' : undefined,
      hasSales: typeof hasSales === 'string' ? hasSales === 'true' : undefined,
      skip: skip !== undefined ? Number(skip) : undefined,
      take: take !== undefined ? Number(take) : undefined,
      canSeeStats,
    });
  }

  @Get('summary')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Global branch summary (counts + totals across all branches)' })
  summary() {
    return this.branchesService.summary();
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Get a branch by ID' })
  findOne(@Param('id') id: string) {
    return this.branchesService.findOne(id);
  }

  @Get(':id/stats')
  @Roles('ADMIN', 'ACCOUNTANT')
  @ApiOperation({ summary: 'Get branch performance stats' })
  stats(@Param('id') id: string) {
    return this.branchesService.stats(id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update a branch' })
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branchesService.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Delete a branch (Admin only)' })
  remove(@Param('id') id: string) {
    return this.branchesService.remove(id);
  }
}
