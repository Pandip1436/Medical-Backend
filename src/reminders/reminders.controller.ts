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
  findAll(@Query('branchId') branchId?: string) {
    return this.service.findAll(branchId);
  }

  @Get('due-today')
  findDueToday(@Query('branchId') branchId?: string) {
    return this.service.findDueToday(branchId);
  }

  @Post()
  create(@Body() dto: CreateReminderDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReminderDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/contacts')
  addContactLog(@Param('id') id: string, @Body() dto: CreateContactLogDto) {
    return this.service.addContactLog(id, dto);
  }

  @Get(':id/contacts')
  getContactLogs(@Param('id') id: string) {
    return this.service.getContactLogs(id);
  }
}
