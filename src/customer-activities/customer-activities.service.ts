import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, CustomerActivityType, CustomerActivityStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerActivityDto } from './dto/create-customer-activity.dto';
import { UpdateCustomerActivityDto } from './dto/update-customer-activity.dto';

@Injectable()
export class CustomerActivitiesService {
  constructor(private readonly prisma: PrismaService) {}

  // Confirm the customer exists and is visible to this branch before any
  // activity read/write. Mirrors customers.service findOne's branch-scope rule.
  private async assertCustomerVisible(customerId: string, branchId?: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, branchId: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    if (branchId && customer.branchId && customer.branchId !== branchId) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async findAll(
    customerId: string,
    branchId: string | undefined,
    opts: {
      type?: CustomerActivityType;
      from?: string;
      to?: string;
      skip?: number;
      take?: number;
    },
  ) {
    await this.assertCustomerVisible(customerId, branchId);

    const where: Prisma.CustomerActivityWhereInput = { customerId };
    if (opts.type) where.type = opts.type;
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) where.createdAt.gte = new Date(opts.from);
      if (opts.to) where.createdAt.lte = new Date(opts.to);
    }

    const paginated =
      typeof opts.skip === 'number' && typeof opts.take === 'number';
    const safeTake = paginated ? Math.min(Math.max(opts.take!, 1), 100) : undefined;
    const safeSkip = paginated ? Math.max(opts.skip!, 0) : undefined;

    const include = {
      createdBy: { select: { id: true, name: true, email: true } },
    } satisfies Prisma.CustomerActivityInclude;

    if (!paginated) {
      return this.prisma.customerActivity.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
      });
    }

    const [data, total] = await Promise.all([
      this.prisma.customerActivity.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: safeSkip,
        take: safeTake,
      }),
      this.prisma.customerActivity.count({ where }),
    ]);

    return {
      data,
      total,
      hasMore: (safeSkip ?? 0) + data.length < total,
    };
  }

  async create(
    customerId: string,
    dto: CreateCustomerActivityDto,
    ctx: { userId: string; branchId?: string },
  ) {
    await this.assertCustomerVisible(customerId, ctx.branchId);

    // Enforce per-type field requirements. DTO @ValidateIf already covers most
    // of this — duplicated here so a malformed payload that slips past the
    // pipe still fails loudly.
    if (dto.type === CustomerActivityType.REMINDER) {
      if (!dto.title || !dto.dueAt) {
        throw new BadRequestException(
          'Reminders require both `title` and `dueAt`.',
        );
      }
    } else {
      if (!dto.notes || !dto.notes.trim()) {
        throw new BadRequestException('`notes` is required for this activity type.');
      }
    }

    const data: Prisma.CustomerActivityCreateInput = {
      customer: { connect: { id: customerId } },
      createdBy: { connect: { id: ctx.userId } },
      type: dto.type,
      notes: dto.notes,
      title: dto.type === CustomerActivityType.REMINDER ? dto.title : null,
      subject: dto.type === CustomerActivityType.EMAIL ? dto.subject ?? null : null,
      contactName: dto.contactName ?? null,
      occurredAt:
        dto.type === CustomerActivityType.REMINDER
          ? null
          : dto.occurredAt
            ? new Date(dto.occurredAt)
            : new Date(),
      dueAt:
        dto.type === CustomerActivityType.REMINDER && dto.dueAt
          ? new Date(dto.dueAt)
          : null,
      status:
        dto.type === CustomerActivityType.REMINDER
          ? dto.status ?? CustomerActivityStatus.PENDING
          : null,
      ...(ctx.branchId ? { branch: { connect: { id: ctx.branchId } } } : {}),
    };

    try {
      return await this.prisma.customerActivity.create({
        data,
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });
    } catch (err: any) {
      throw new BadRequestException(
        `Could not save activity: ${err?.message ?? 'unknown error'}`,
      );
    }
  }

  async update(
    customerId: string,
    id: string,
    dto: UpdateCustomerActivityDto,
    branchId?: string,
  ) {
    await this.assertCustomerVisible(customerId, branchId);
    const existing = await this.prisma.customerActivity.findUnique({
      where: { id },
    });
    if (!existing || existing.customerId !== customerId) {
      throw new NotFoundException('Activity not found');
    }

    const data: Prisma.CustomerActivityUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.contactName !== undefined) data.contactName = dto.contactName;
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.occurredAt !== undefined) {
      data.occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : null;
    }
    if (dto.dueAt !== undefined) {
      data.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    }

    return this.prisma.customerActivity.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async remove(customerId: string, id: string, branchId?: string) {
    await this.assertCustomerVisible(customerId, branchId);
    const existing = await this.prisma.customerActivity.findUnique({
      where: { id },
    });
    if (!existing || existing.customerId !== customerId) {
      throw new NotFoundException('Activity not found');
    }
    return this.prisma.customerActivity.delete({ where: { id } });
  }
}
