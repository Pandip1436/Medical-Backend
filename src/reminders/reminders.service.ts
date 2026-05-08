import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateReminderDto, UpdateReminderDto, CreateContactLogDto } from './dto/reminder.dto'

@Injectable()
export class RemindersService {
  constructor(private prisma: PrismaService) {}

  // Reject day-of-month values that don't fire in every month. 31 is missing
  // in 4 months, 30 is missing in Feb, 29 is missing in non-leap Feb. Cap at
  // 28 so reminders fire reliably year-round; for true "last day of month"
  // semantics we'd need a separate flag, which we don't have today.
  private validateDayOfMonth(day: number) {
    if (day < 1 || day > 28) {
      throw new BadRequestException(
        'dayOfMonth must be between 1 and 28 so the reminder fires every month (use 28 for end-of-month).',
      );
    }
  }

  // Confirm the reminder belongs to the caller's branch before any mutation.
  // Without this, a user in BR1 could PATCH or DELETE a reminder owned by HQ
  // simply by guessing the id.
  private async assertOwnedByBranch(id: string, branchId?: string) {
    const existing = await this.prisma.customerReminder.findUnique({
      where: { id },
      select: { id: true, branchId: true },
    })
    if (!existing) throw new NotFoundException('Reminder not found')
    if (branchId && existing.branchId && existing.branchId !== branchId) {
      throw new NotFoundException('Reminder not found')
    }
    return existing
  }

  async findAll(branchId?: string) {
    return this.prisma.customerReminder.findMany({
      where: branchId ? { branchId } : undefined,
      include: {
        customer: { select: { id: true, name: true, phone: true, type: true, email: true } },
        contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
      },
      orderBy: { dayOfMonth: 'asc' },
    })
  }

  async findDueToday(branchId?: string) {
    const today = new Date().getDate()
    return this.prisma.customerReminder.findMany({
      where: { dayOfMonth: today, ...(branchId ? { branchId } : {}) },
      include: {
        customer: { select: { id: true, name: true, phone: true, type: true, email: true } },
        contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
      },
    })
  }

  async create(dto: CreateReminderDto) {
    this.validateDayOfMonth(dto.dayOfMonth)
    return this.prisma.customerReminder.create({
      data: {
        customerId: dto.customerId,
        dayOfMonth: dto.dayOfMonth,
        title: dto.title,
        notes: dto.notes,
        branchId: dto.branchId,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, type: true, email: true } },
        contacts: true,
      },
    })
  }

  async update(id: string, dto: UpdateReminderDto, branchId?: string) {
    await this.assertOwnedByBranch(id, branchId)
    if (dto.dayOfMonth !== undefined) {
      this.validateDayOfMonth(dto.dayOfMonth)
    }
    return this.prisma.customerReminder.update({
      where: { id },
      data: dto,
      include: {
        customer: { select: { id: true, name: true, phone: true, type: true, email: true } },
        contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
      },
    })
  }

  async remove(id: string, branchId?: string) {
    await this.assertOwnedByBranch(id, branchId)
    return this.prisma.customerReminder.delete({ where: { id } })
  }

  async addContactLog(reminderId: string, dto: CreateContactLogDto, branchId?: string) {
    await this.assertOwnedByBranch(reminderId, branchId)
    return this.prisma.reminderContact.create({
      data: {
        reminderId,
        status: dto.status as any,
        notes: dto.notes,
      },
    })
  }

  async getContactLogs(reminderId: string, branchId?: string) {
    await this.assertOwnedByBranch(reminderId, branchId)
    return this.prisma.reminderContact.findMany({
      where: { reminderId },
      orderBy: { contactedAt: 'desc' },
    })
  }
}
