import { Controller, Get, Post, Param, Body, Query, Request, UseGuards } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/approvals')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'List approval requests. Admins see all; others see only their own.' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'type', required: false })
  findAll(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    return this.approvalsService.findAll({
      branchId: req.user.branchId,
      status,
      type,
      userId: req.user.userId,
      role: req.user.role,
    });
  }

  @Get('pending-count')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  @ApiOperation({ summary: 'Count pending approval requests for badge display' })
  pendingCount(@Request() req: any) {
    return this.approvalsService.countPending(req.user.branchId).then(count => ({ count }));
  }

  @Get(':id')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  findOne(@Param('id') id: string) {
    return this.approvalsService.findOne(id);
  }

  @Post(':id/approve')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Approve a pending request and execute the action' })
  approve(
    @Param('id') id: string,
    @Body() body: { reviewNote?: string },
    @Request() req: any,
  ) {
    return this.approvalsService.approve(id, req.user.userId, body.reviewNote);
  }

  @Post(':id/reject')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Reject a pending request' })
  reject(
    @Param('id') id: string,
    @Body() body: { reviewNote: string },
    @Request() req: any,
  ) {
    return this.approvalsService.reject(id, req.user.userId, body.reviewNote);
  }
}
