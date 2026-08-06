import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateReminderDto, UpdateReminderDto, CreateContactLogDto } from './dto/reminder.dto'

@Injectable()
export class RemindersService {
  constructor(private prisma: PrismaService) {}

  // Day-of-month for a monthly reminder. Days 29–31 don't exist in every month,
  // so they CLAMP to the month's last day when firing (see findDueToday) — e.g.
  // a day-31 reminder fires on Feb 28 / Apr 30. So the full 1–31 range is valid.
  private validateDayOfMonth(day: number) {
    if (day < 1 || day > 31) {
      throw new BadRequestException('dayOfMonth must be between 1 and 31.');
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

  async findAll(branchId?: string, customerId?: string) {
    const where: any = {}
    if (branchId) where.branchId = branchId
    if (customerId) where.customerId = customerId
    return this.prisma.customerReminder.findMany({
      where: Object.keys(where).length ? where : undefined,
      include: {
        customer: { select: { id: true, name: true, phone: true, type: true, email: true, address: true } },
        contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
        products: { select: { productId: true, productName: true } },
      },
      orderBy: { dayOfMonth: 'asc' },
    })
  }

  async findDueToday(branchId?: string) {
    const now = new Date()
    const today = now.getDate()
    // Last day of the current month. On that day, sweep in any reminder whose
    // scheduled day is >= today (i.e. 29/30/31 that don't exist this month) so
    // end-of-month reminders fire — clamp-to-end-of-month semantics.
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const dayMatch = today === lastDay ? { gte: today } : today
    return this.prisma.customerReminder.findMany({
      where: { dayOfMonth: dayMatch, isActive: true, ...(branchId ? { branchId } : {}) },
      include: {
        customer: { select: { id: true, name: true, phone: true, type: true, email: true, address: true } },
        contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
        products: { select: { productId: true, productName: true } },
      },
    })
  }

  // Fetch the requested products and snapshot their current names into
  // ReminderProduct rows, so a later product rename doesn't retroactively
  // change the wording of messages already sent.
  private async buildProductLinks(productIds: string[] | undefined) {
    if (!productIds?.length) return []
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true },
    })
    return products.map((p) => ({ productId: p.id, productName: p.name }))
  }

  async create(dto: CreateReminderDto) {
    this.validateDayOfMonth(dto.dayOfMonth)
    const productLinks = await this.buildProductLinks(dto.productIds)
    return this.prisma.customerReminder.create({
      data: {
        customerId: dto.customerId,
        dayOfMonth: dto.dayOfMonth,
        title: dto.title,
        notes: dto.notes,
        branchId: dto.branchId,
        products: productLinks.length ? { create: productLinks } : undefined,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, type: true, email: true, address: true } },
        contacts: true,
        products: { select: { productId: true, productName: true } },
      },
    })
  }

  // Bulk-create reminders for a list of customers. Used by the Outstanding
  // Receivables page's "Bulk Reminders" button — one reminder per customer.
  // Idempotent on (customerId + title): an existing reminder with the same
  // title for the same customer is left untouched and reported as 'skipped'.
  async createBulk(
    customerIds: string[],
    options: { title?: string; dayOfMonth?: number; branchId?: string } = {},
  ) {
    const title = options.title?.trim() || 'Payment follow-up'
    // Clamp into the valid 1–31 range (days 29–31 clamp to end-of-month at fire time).
    const rawDay = options.dayOfMonth ?? new Date().getDate()
    const dayOfMonth = Math.min(Math.max(rawDay, 1), 31)
    const branchId = options.branchId

    // Look up existing reminders for these customers + title so we don't
    // re-create the same follow-up.
    const existing = await this.prisma.customerReminder.findMany({
      where: {
        customerId: { in: customerIds },
        title,
        ...(branchId ? { branchId } : {}),
      },
      select: { customerId: true },
    })
    const existingIds = new Set(existing.map((r) => r.customerId))
    const toCreate = customerIds.filter((id) => !existingIds.has(id))

    if (toCreate.length === 0) {
      return { created: 0, skipped: customerIds.length }
    }

    await this.prisma.customerReminder.createMany({
      data: toCreate.map((customerId) => ({
        customerId,
        dayOfMonth,
        title,
        branchId: branchId ?? null,
      })),
      skipDuplicates: true,
    })

    return {
      created: toCreate.length,
      skipped: customerIds.length - toCreate.length,
    }
  }

  async update(id: string, dto: UpdateReminderDto, branchId?: string) {
    await this.assertOwnedByBranch(id, branchId)
    if (dto.dayOfMonth !== undefined) {
      this.validateDayOfMonth(dto.dayOfMonth)
    }
    // followUpDate arrives as an ISO string (set) or explicit null (clear);
    // Prisma needs a Date | null, so coerce it before the write.
    // productIds, when provided, replaces the full linked-product set rather
    // than merging — handled separately below via a transaction.
    const { followUpDate, productIds, ...rest } = dto
    const data: any = { ...rest }
    if (followUpDate !== undefined) {
      data.followUpDate = followUpDate ? new Date(followUpDate) : null
    }

    if (productIds === undefined) {
      return this.prisma.customerReminder.update({
        where: { id },
        data,
        include: {
          customer: { select: { id: true, name: true, phone: true, type: true, email: true, address: true } },
          contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
          products: { select: { productId: true, productName: true } },
        },
      })
    }

    const productLinks = await this.buildProductLinks(productIds)
    const [, reminder] = await this.prisma.$transaction([
      this.prisma.reminderProduct.deleteMany({ where: { reminderId: id } }),
      this.prisma.customerReminder.update({
        where: { id },
        data: { ...data, products: productLinks.length ? { create: productLinks } : undefined },
        include: {
          customer: { select: { id: true, name: true, phone: true, type: true, email: true, address: true } },
          contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
          products: { select: { productId: true, productName: true } },
        },
      }),
    ])
    return reminder
  }

  async remove(id: string, branchId?: string) {
    await this.assertOwnedByBranch(id, branchId)
    return this.prisma.customerReminder.delete({ where: { id } })
  }

  async addContactLog(reminderId: string, dto: CreateContactLogDto, branchId?: string) {
    await this.assertOwnedByBranch(reminderId, branchId)
    // The follow-up date the customer requested at this contact (if any).
    const followUpDate = dto.followUpDate ? new Date(dto.followUpDate) : null
    // The latest contact decides the reminder's active follow-up: logging a
    // contact with a date schedules it; logging one without a date clears any
    // prior follow-up so the reminder reverts to its monthly cycle. Both writes
    // happen together so the log and the reminder never disagree.
    const [contact] = await this.prisma.$transaction([
      this.prisma.reminderContact.create({
        data: {
          reminderId,
          status: dto.status as any,
          notes: dto.notes,
          followUpDate,
        },
      }),
      this.prisma.customerReminder.update({
        where: { id: reminderId },
        data: { followUpDate },
      }),
    ])
    return contact
  }

  async getContactLogs(reminderId: string, branchId?: string) {
    await this.assertOwnedByBranch(reminderId, branchId)
    return this.prisma.reminderContact.findMany({
      where: { reminderId },
      orderBy: { contactedAt: 'desc' },
    })
  }
}
