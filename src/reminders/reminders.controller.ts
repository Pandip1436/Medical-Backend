import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { RemindersService } from './reminders.service';
import {
  CreateReminderDto,
  UpdateReminderDto,
  CreateContactLogDto,
} from './dto/reminder.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ApiBearerAuth } from '@nestjs/swagger';

// Reminders are customer-follow-up records. Admins and pharmacists work with
// them directly; other roles don't have a reason to read or modify them.
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PHARMACIST')
@Controller('api/v1/reminders')
export class RemindersController {
  constructor(private readonly service: RemindersService) {}

  @Get()
  findAll(
    @Request() req: any,
    @Query('customerId') customerId?: string,
  ) {
    return this.service.findAll(req.user.branchId, customerId);
  }

  @Get('due-today')
  findDueToday(@Request() req: any) {
    return this.service.findDueToday(req.user.branchId);
  }

  @Post()
  create(@Body() dto: CreateReminderDto, @Request() req: any) {
    // Force the reminder onto the user's branch so a BR1 user can't slip a
    // BR2 branchId into the body.
    return this.service.create({ ...dto, branchId: req.user.branchId ?? dto.branchId });
  }

  @Post('bulk')
  createBulk(
    @Body() body: { customerIds: string[]; title?: string; dayOfMonth?: number },
    @Request() req: any,
  ) {
    const customerIds = Array.isArray(body?.customerIds) ? body.customerIds.filter(Boolean) : [];
    return this.service.createBulk(customerIds, {
      title: body?.title,
      dayOfMonth: body?.dayOfMonth,
      branchId: req.user.branchId ?? undefined,
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReminderDto, @Request() req: any) {
    return this.service.update(id, dto, req.user.branchId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.service.remove(id, req.user.branchId);
  }

  @Post(':id/contacts')
  addContactLog(@Param('id') id: string, @Body() dto: CreateContactLogDto, @Request() req: any) {
    return this.service.addContactLog(id, dto, req.user.branchId);
  }

  @Get(':id/contacts')
  getContactLogs(@Param('id') id: string, @Request() req: any) {
    return this.service.getContactLogs(id, req.user.branchId);
  }
}
