import {
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
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('companies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Search companies (paginated, branch-scoped)' })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  findAll(
    @Request() req: AuthenticatedRequest,
    @Query('q') q?: string,
    @Query('branchId') qBranchId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.companiesService.findAll({
      q,
      branchId: req.user.branchId ?? qBranchId ?? undefined,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  findOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.companiesService.findOne(id, req.user.branchId ?? undefined);
  }

  @Post()
  @Roles('ADMIN', 'PHARMACIST', 'SALESPERSON')
  create(
    @Body() dto: CreateCompanyDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? qBranchId;
    return this.companiesService.create(dto, effectiveBranchId!);
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST', 'SALESPERSON')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.companiesService.update(id, dto, req.user.branchId ?? undefined);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PHARMACIST')
  remove(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.companiesService.remove(id, req.user.branchId ?? undefined);
  }
}
