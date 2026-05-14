import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, SupplierActivityType, SupplierActivityStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierActivityDto } from './dto/create-supplier-activity.dto';
import { UpdateSupplierActivityDto } from './dto/update-supplier-activity.dto';

@Injectable()
export class SupplierActivitiesService {
  constructor(private readonly prisma: PrismaService) {}

  // Confirm the supplier exists and is visible to this branch before any
  // activity read/write. Mirrors suppliers.service.findOne's branch-scope rule.
  private async assertSupplierVisible(supplierId: string, branchId?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, branchId: true },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    if (branchId && supplier.branchId && supplier.branchId !== branchId) {
      throw new NotFoundException('Supplier not found');
    }
    return supplier;
  }

  async findAll(
    supplierId: string,
    branchId: string | undefined,
    opts: {
      type?: SupplierActivityType;
      from?: string;
      to?: string;
      skip?: number;
      take?: number;
    },
  ) {
    await this.assertSupplierVisible(supplierId, branchId);

    const where: Prisma.SupplierActivityWhereInput = { supplierId };
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
    } satisfies Prisma.SupplierActivityInclude;

    if (!paginated) {
      return this.prisma.supplierActivity.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
      });
    }

    const [data, total] = await Promise.all([
      this.prisma.supplierActivity.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: safeSkip,
        take: safeTake,
      }),
      this.prisma.supplierActivity.count({ where }),
    ]);

    return {
      data,
      total,
      hasMore: (safeSkip ?? 0) + data.length < total,
    };
  }

  async create(
    supplierId: string,
    dto: CreateSupplierActivityDto,
    ctx: { userId: string; branchId?: string },
  ) {
    await this.assertSupplierVisible(supplierId, ctx.branchId);

    // Enforce per-type field requirements. DTO @ValidateIf already covers most
    // of this — duplicated here so a malformed payload that slips past the
    // pipe (e.g. mixed-type bulk imports later) still fails loudly.
    if (dto.type === SupplierActivityType.REMINDER) {
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

    const data: Prisma.SupplierActivityCreateInput = {
      supplier: { connect: { id: supplierId } },
      createdBy: { connect: { id: ctx.userId } },
      type: dto.type,
      notes: dto.notes,
      title: dto.type === SupplierActivityType.REMINDER ? dto.title : null,
      // EMAIL is the only type where subject is meaningful.
      subject: dto.type === SupplierActivityType.EMAIL ? dto.subject ?? null : null,
      contactName: dto.contactName ?? null,
      occurredAt:
        dto.type === SupplierActivityType.REMINDER
          ? null
          : dto.occurredAt
            ? new Date(dto.occurredAt)
            : new Date(),
      dueAt:
        dto.type === SupplierActivityType.REMINDER && dto.dueAt
          ? new Date(dto.dueAt)
          : null,
      status:
        dto.type === SupplierActivityType.REMINDER
          ? dto.status ?? SupplierActivityStatus.PENDING
          : null,
      ...(ctx.branchId ? { branch: { connect: { id: ctx.branchId } } } : {}),
    };

    try {
      return await this.prisma.supplierActivity.create({
        data,
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });
    } catch (err: any) {
      // TEMP: surface Prisma errors verbatim so the actual failure cause is
      // visible in the backend console + the toast. Remove once stable.
      console.error('[supplier-activities] create failed', {
        supplierId,
        userId: ctx.userId,
        branchId: ctx.branchId,
        type: dto.type,
        prismaCode: err?.code,
        message: err?.message,
      });
      throw new BadRequestException(
        `Could not save activity: ${err?.message ?? 'unknown error'}`,
      );
    }
  }

  async update(
    supplierId: string,
    id: string,
    dto: UpdateSupplierActivityDto,
    branchId?: string,
  ) {
    await this.assertSupplierVisible(supplierId, branchId);
    const existing = await this.prisma.supplierActivity.findUnique({
      where: { id },
    });
    if (!existing || existing.supplierId !== supplierId) {
      throw new NotFoundException('Activity not found');
    }

    const data: Prisma.SupplierActivityUpdateInput = {};
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

    return this.prisma.supplierActivity.update({
      where: { id },
      data,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async remove(supplierId: string, id: string, branchId?: string) {
    await this.assertSupplierVisible(supplierId, branchId);
    const existing = await this.prisma.supplierActivity.findUnique({
      where: { id },
    });
    if (!existing || existing.supplierId !== supplierId) {
      throw new NotFoundException('Activity not found');
    }
    return this.prisma.supplierActivity.delete({ where: { id } });
  }
}
