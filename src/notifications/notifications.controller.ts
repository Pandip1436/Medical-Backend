import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Request,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

// All notification routes are role-gated. Read/manage actions are open to
// most operating roles; the `generate/*` endpoints kick off background sweeps
// (low-stock, expiry, payment-due) and stay admin-only.
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  findAll(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') queryBranchId?: string,
    @Query('unread') unread?: string,
  ) {
    const branchId = req.user.branchId ?? queryBranchId ?? undefined;
    return this.service.findAll(branchId, unread === 'true');
  }

  @Post()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  create(
    @Body() dto: CreateNotificationDto,
    @Request() req: AuthenticatedRequest,
    @Query('branchId') queryBranchId?: string,
  ) {
    if (!dto.branchId)
      dto.branchId = req.user.branchId ?? queryBranchId ?? undefined;
    return this.service.create(dto);
  }

  @Patch(':id/read')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  markAsRead(@Param('id') id: string) {
    return this.service.markAsRead(id);
  }

  @Patch('read-all')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  markAllAsRead(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') queryBranchId?: string,
  ) {
    const branchId = req.user.branchId ?? queryBranchId ?? undefined;
    return this.service.markAllAsRead(branchId);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Delete()
  @Roles('ADMIN')
  clearAll(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') queryBranchId?: string,
  ) {
    const branchId = req.user.branchId ?? queryBranchId ?? undefined;
    return this.service.clearAll(branchId);
  }

  // ── Auto-generate alerts (admin-only — these run sweeps) ──────────────────

  @Post('generate/low-stock')
  @Roles('ADMIN')
  generateLowStock(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') queryBranchId?: string,
  ) {
    const branchId = req.user.branchId ?? queryBranchId ?? undefined;
    return this.service.generateLowStockAlerts(branchId);
  }

  @Post('generate/expiry')
  @Roles('ADMIN')
  generateExpiry(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') queryBranchId?: string,
    @Query('days') days?: string,
  ) {
    const branchId = req.user.branchId ?? queryBranchId ?? undefined;
    return this.service.generateExpiryAlerts(
      branchId,
      days ? parseInt(days) : 90,
    );
  }

  @Post('generate/payment-due')
  @Roles('ADMIN')
  generatePaymentDue(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') queryBranchId?: string,
  ) {
    const branchId = req.user.branchId ?? queryBranchId ?? undefined;
    return this.service.generatePaymentDueAlerts(branchId);
  }

  @Post('generate/all')
  @Roles('ADMIN')
  async generateAll(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') queryBranchId?: string,
  ) {
    const branchId = req.user.branchId ?? queryBranchId ?? undefined;
    const [lowStock, expiry, paymentDue] = await Promise.all([
      this.service.generateLowStockAlerts(branchId),
      this.service.generateExpiryAlerts(branchId),
      this.service.generatePaymentDueAlerts(branchId),
    ]);
    return { lowStock, expiry, paymentDue };
  }
}
