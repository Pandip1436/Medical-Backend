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
import { LeadActivityType } from '@prisma/client';
import { LeadActivitiesService } from './lead-activities.service';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';
import { UpdateLeadActivityDto } from './dto/update-lead-activity.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('lead-activities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/leads/:leadId/activities')
export class LeadActivitiesController {
  constructor(private readonly activitiesService: LeadActivitiesService) {}

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'List lead activities' })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  findAll(
    @Param('leadId') leadId: string,
    @Request() req: AuthenticatedRequest,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const branchId = req.user.branchId ?? undefined;
    const skipNum = skip !== undefined ? Number(skip) : undefined;
    const takeNum = take !== undefined ? Number(take) : undefined;
    const typed =
      type && (Object.values(LeadActivityType) as string[]).includes(type)
        ? (type as LeadActivityType)
        : undefined;
    return this.activitiesService.findAll(leadId, branchId, {
      type: typed,
      from,
      to,
      skip: Number.isFinite(skipNum) ? skipNum : undefined,
      take: Number.isFinite(takeNum) ? takeNum : undefined,
    });
  }

  @Post()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Log an activity against a lead' })
  create(
    @Param('leadId') leadId: string,
    @Body() dto: CreateLeadActivityDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.activitiesService.create(leadId, dto, {
      userId: req.user.userId,
      branchId: req.user.branchId ?? undefined,
    });
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({
    summary: 'Update an activity (commonly to flip reminder status)',
  })
  update(
    @Param('leadId') leadId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadActivityDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.activitiesService.update(
      leadId,
      id,
      dto,
      req.user.branchId ?? undefined,
    );
  }

  @Delete(':id')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Delete an activity' })
  remove(
    @Param('leadId') leadId: string,
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.activitiesService.remove(
      leadId,
      id,
      req.user.branchId ?? undefined,
    );
  }
}
