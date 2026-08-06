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
import { CreateNotificationDto, NotificationType } from './dto/create-notification.dto';
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

  // Pagination params (`skip` / `take`) are optional. When both are present
  // the service returns `{ data, total, hasMore }` (used by the notifications
  // folder view's infinite scroll). When omitted, returns a raw array — the
  // shape the store's initial fetch + 60s poller still expect.
  //
  // `type` narrows to one NotificationType. `reminders=only|exclude` splits
  // the SYSTEM type into the Reminder vs System folders (reminders are
  // SYSTEM rows tagged with a `[reminderId:…]` marker).
  @Get()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  findAll(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') queryBranchId?: string,
    @Query('unread') unread?: string,
    @Query('read') read?: string,
    @Query('type') type?: string,
    @Query('reminders') reminders?: string,
    @Query('resolved') resolved?: string,
    @Query('q') q?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('sort') sort?: string,
  ) {
    const branchId = req.user.branchId ?? queryBranchId ?? undefined;
    const typedType =
      type && (Object.values(NotificationType) as string[]).includes(type)
        ? (type as NotificationType)
        : undefined;
    const remindersFilter =
      reminders === 'only' || reminders === 'exclude' ? reminders : undefined;
    const resolvedFilter =
      resolved === 'only' || resolved === 'exclude' ? resolved : undefined;
    const sortFilter =
      sort === 'oldest' || sort === 'unread' || sort === 'newest'
        ? sort
        : undefined;
    const skipN = skip !== undefined ? Number(skip) : undefined;
    const takeN = take !== undefined ? Number(take) : undefined;
    return this.service.findAll({
      branchId,
      userId: req.user.userId,
      role: (req.user as { role?: string }).role ?? null,
      onlyUnread: unread === 'true',
      onlyRead: read === 'true',
      type: typedType,
      reminders: remindersFilter,
      resolved: resolvedFilter,
      q: q && q.trim() ? q.trim() : undefined,
      sort: sortFilter,
      skip: Number.isFinite(skipN) ? skipN : undefined,
      take: Number.isFinite(takeN) ? takeN : undefined,
    });
  }

  @Post()
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
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
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  markAsRead(@Param('id') id: string) {
    return this.service.markAsRead(id);
  }

  @Patch('read-all')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  markAllAsRead(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') queryBranchId?: string,
  ) {
    const branchId = req.user.branchId ?? queryBranchId ?? undefined;
    return this.service.markAllAsRead(branchId, req.user.userId, (req.user as { role?: string }).role ?? null);
  }

  @Patch('read-bulk')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  markManyAsRead(@Body() body: { ids: string[] }) {
    return this.service.markManyAsRead(body?.ids ?? []);
  }

  @Patch(':id/snooze')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  snooze(@Param('id') id: string, @Body() body: { until: string }) {
    return this.service.snooze(id, new Date(body.until));
  }

  @Patch(':id/resolve')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  resolve(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.service.resolve(id, req.user.userId);
  }

  @Delete(':id')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('delete-bulk')
  @Roles('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON')
  removeMany(@Body() body: { ids: string[] }) {
    return this.service.removeMany(body?.ids ?? []);
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

  // Manual trigger for the customer-reminder due-today check (normally runs
  // on server boot + every 24h via NotificationsScheduler). Useful to test
  // the auto-WhatsApp flow without restarting the backend. Ignores
  // branchId — generateReminderAlerts() checks all branches at once.
  @Post('generate/reminders')
  @Roles('ADMIN')
  generateReminders() {
    return this.service.generateReminderAlerts();
  }

  @Post('generate/all')
  @Roles('ADMIN')
  async generateAll(
    @Request() req: AuthenticatedRequest,
    @Query('branchId') queryBranchId?: string,
  ) {
    const branchId = req.user.branchId ?? queryBranchId ?? undefined;
    const [lowStock, expiry, paymentDue, supplierDue, reminders] = await Promise.all([
      this.service.generateLowStockAlerts(branchId),
      this.service.generateExpiryAlerts(branchId),
      this.service.generatePaymentDueAlerts(branchId),
      this.service.generateSupplierPaymentDueAlerts(branchId),
      this.service.generateReminderAlerts(),
    ]);
    return { lowStock, expiry, paymentDue, supplierDue, reminders };
  }
}
