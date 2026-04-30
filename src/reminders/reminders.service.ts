import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateReminderDto, UpdateReminderDto, CreateContactLogDto } from './dto/reminder.dto'

@Injectable()
export class RemindersService {
  constructor(private prisma: PrismaService) {}

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

  async update(id: string, dto: UpdateReminderDto) {
    return this.prisma.customerReminder.update({
      where: { id },
      data: dto,
      include: {
        customer: { select: { id: true, name: true, phone: true, type: true, email: true } },
        contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
      },
    })
  }

  async remove(id: string) {
    return this.prisma.customerReminder.delete({ where: { id } })
  }

  async addContactLog(reminderId: string, dto: CreateContactLogDto) {
    return this.prisma.reminderContact.create({
      data: {
        reminderId,
        status: dto.status as any,
        notes: dto.notes,
      },
    })
  }

  async getContactLogs(reminderId: string) {
    return this.prisma.reminderContact.findMany({
      where: { reminderId },
      orderBy: { contactedAt: 'desc' },
    })
  }
}
