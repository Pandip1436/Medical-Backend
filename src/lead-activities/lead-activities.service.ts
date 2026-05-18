import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  Prisma,
  LeadActivityType,
  LeadActivityStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';
import { UpdateLeadActivityDto } from './dto/update-lead-activity.dto';

@Injectable()
export class LeadActivitiesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertLeadVisible(leadId: string, branchId?: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, branchId: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    if (branchId && lead.branchId !== branchId) {
      throw new NotFoundException('Lead not found');
    }
    return lead;
  }

  async findAll(
    leadId: string,
    branchId: string | undefined,
    opts: {
      type?: LeadActivityType;
      from?: string;
      to?: string;
      skip?: number;
      take?: number;
    },
  ) {
    await this.assertLeadVisible(leadId, branchId);

    const where: Prisma.LeadActivityWhereInput = { leadId };
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
    } satisfies Prisma.LeadActivityInclude;

    if (!paginated) {
      return this.prisma.leadActivity.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
      });
    }

    const [data, total] = await Promise.all([
      this.prisma.leadActivity.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: safeSkip,
        take: safeTake,
      }),
      this.prisma.leadActivity.count({ where }),
    ]);

    return {
      data,
      total,
      hasMore: (safeSkip ?? 0) + data.length < total,
    };
  }

  async create(
    leadId: string,
    dto: CreateLeadActivityDto,
    ctx: { userId: string; branchId?: string },
  ) {
    await this.assertLeadVisible(leadId, ctx.branchId);

    if (dto.type === LeadActivityType.REMINDER) {
      if (!dto.title || !dto.dueAt) {
        throw new BadRequestException(
          'Reminders require both `title` and `dueAt`.',
        );
      }
    } else {
      if (!dto.notes || !dto.notes.trim()) {
        throw new BadRequestException(
          '`notes` is required for this activity type.',
        );
      }
    }

    // Creating any activity flips the lead's touchStatus to TOUCHED — that's
    // what "untouched" tab is built around. Single update beside the create
    // so the list/tab counts stay consistent without an extra round trip.
    const [activity] = await this.prisma.$transaction([
      this.prisma.leadActivity.create({
        data: {
          lead: { connect: { id: leadId } },
          createdBy: { connect: { id: ctx.userId } },
          type: dto.type,
          notes: dto.notes,
          title: dto.type === LeadActivityType.REMINDER ? dto.title : null,
          subject:
            dto.type === LeadActivityType.EMAIL
              ? dto.subject ?? null
              : null,
          contactName: dto.contactName ?? null,
          occurredAt:
            dto.type === LeadActivityType.REMINDER
              ? null
              : dto.occurredAt
                ? new Date(dto.occurredAt)
                : new Date(),
          dueAt:
            dto.type === LeadActivityType.REMINDER && dto.dueAt
              ? new Date(dto.dueAt)
              : null,
          status:
            dto.type === LeadActivityType.REMINDER
              ? dto.status ?? LeadActivityStatus.PENDING
              : null,
          ...(ctx.branchId ? { branch: { connect: { id: ctx.branchId } } } : {}),
        },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.lead.update({
        where: { id: leadId },
        data: { touchStatus: 'TOUCHED' },
      }),
    ]);
    return activity;
  }

  async update(
    leadId: string,
    id: string,
    dto: UpdateLeadActivityDto,
    branchId?: string,
  ) {
    await this.assertLeadVisible(leadId, branchId);
    const existing = await this.prisma.leadActivity.findUnique({
      where: { id },
    });
    if (!existing || existing.leadId !== leadId) {
      throw new NotFoundException('Activity not found');
    }

    const data: Prisma.LeadActivityUpdateInput = {};
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

    return this.prisma.leadActivity.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async remove(leadId: string, id: string, branchId?: string) {
    await this.assertLeadVisible(leadId, branchId);
    const existing = await this.prisma.leadActivity.findUnique({
      where: { id },
    });
    if (!existing || existing.leadId !== leadId) {
      throw new NotFoundException('Activity not found');
    }
    return this.prisma.leadActivity.delete({ where: { id } });
  }
}
