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
import { CustomerActivityType } from '@prisma/client';
import { CustomerActivitiesService } from './customer-activities.service';
import { CreateCustomerActivityDto } from './dto/create-customer-activity.dto';
import { UpdateCustomerActivityDto } from './dto/update-customer-activity.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

@ApiTags('customer-activities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/customers/:customerId/activities')
export class CustomerActivitiesController {
  constructor(
    private readonly activitiesService: CustomerActivitiesService,
  ) {}

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'List customer activities' })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'branchId', required: false })
  findAll(
    @Param('customerId') customerId: string,
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
      type && (Object.values(CustomerActivityType) as string[]).includes(type)
        ? (type as CustomerActivityType)
        : undefined;
    return this.activitiesService.findAll(customerId, effectiveBranchId, {
      type: typed,
      from,
      to,
      skip: Number.isFinite(skipNum) ? skipNum : undefined,
      take: Number.isFinite(takeNum) ? takeNum : undefined,
    });
  }

  @Post()
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Log an activity against a customer' })
  create(
    @Param('customerId') customerId: string,
    @Body() dto: CreateCustomerActivityDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') qBranchId?: string,
  ) {
    const effectiveBranchId = req.user.branchId ?? qBranchId ?? undefined;
    return this.activitiesService.create(customerId, dto, {
      userId: req.user.userId,
      branchId: effectiveBranchId,
    });
  }

  @Patch(':id')
  @Roles('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Update an activity (commonly to flip reminder status)' })
  update(
    @Param('customerId') customerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerActivityDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.activitiesService.update(
      customerId,
      id,
      dto,
      req.user.branchId ?? undefined,
    );
  }

  @Delete(':id')
  @Roles('ADMIN', 'PHARMACIST')
  @ApiOperation({ summary: 'Delete an activity' })
  remove(
    @Param('customerId') customerId: string,
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.activitiesService.remove(
      customerId,
      id,
      req.user.branchId ?? undefined,
    );
  }
}
