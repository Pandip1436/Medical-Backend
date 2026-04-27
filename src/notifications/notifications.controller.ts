import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Request, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  findAll(
    @Request() req: any,
    @Query('branchId') queryBranchId?: string,
    @Query('unread') unread?: string,
  ) {
    const branchId = req.user.branchId ?? queryBranchId;
    return this.service.findAll(branchId, unread === 'true');
  }

  @Post()
  create(@Body() dto: CreateNotificationDto, @Request() req: any, @Query('branchId') queryBranchId?: string) {
    if (!dto.branchId) dto.branchId = req.user.branchId ?? queryBranchId;
    return this.service.create(dto);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string) {
    return this.service.markAsRead(id);
  }

  @Patch('read-all')
  markAllAsRead(@Request() req: any, @Query('branchId') queryBranchId?: string) {
    const branchId = req.user.branchId ?? queryBranchId;
    return this.service.markAllAsRead(branchId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Delete()
  clearAll(@Request() req: any, @Query('branchId') queryBranchId?: string) {
    const branchId = req.user.branchId ?? queryBranchId;
    return this.service.clearAll(branchId);
  }

  // ── Auto-generate alerts ──────────────────────────────────────────────────

  @Post('generate/low-stock')
  generateLowStock(@Request() req: any, @Query('branchId') queryBranchId?: string) {
    const branchId = req.user.branchId ?? queryBranchId;
    return this.service.generateLowStockAlerts(branchId);
  }

  @Post('generate/expiry')
  generateExpiry(
    @Request() req: any,
    @Query('branchId') queryBranchId?: string,
    @Query('days') days?: string,
  ) {
    const branchId = req.user.branchId ?? queryBranchId;
    return this.service.generateExpiryAlerts(branchId, days ? parseInt(days) : 90);
  }

  @Post('generate/payment-due')
  generatePaymentDue(@Request() req: any, @Query('branchId') queryBranchId?: string) {
    const branchId = req.user.branchId ?? queryBranchId;
    return this.service.generatePaymentDueAlerts(branchId);
  }

  @Post('generate/all')
  async generateAll(@Request() req: any, @Query('branchId') queryBranchId?: string) {
    const branchId = req.user.branchId ?? queryBranchId;
    const [lowStock, expiry, paymentDue] = await Promise.all([
      this.service.generateLowStockAlerts(branchId),
      this.service.generateExpiryAlerts(branchId),
      this.service.generatePaymentDueAlerts(branchId),
    ]);
    return { lowStock, expiry, paymentDue };
  }
}
