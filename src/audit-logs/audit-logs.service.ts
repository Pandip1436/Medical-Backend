import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface ListParams {
  query?: string;
  userId?: string;
  module?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  skip?: number;
  take?: number;
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  // Build the Prisma `where` from optional list filters. Returned as a typed
  // object so both findAll() and stats() can compose the same conditions.
  private buildWhere(params: ListParams): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};
    if (params.query) {
      where.OR = [
        { module: { contains: params.query, mode: 'insensitive' } },
        { action: { contains: params.query, mode: 'insensitive' } },
        { entity: { contains: params.query, mode: 'insensitive' } },
      ];
    }
    if (params.userId) where.userId = params.userId;
    if (params.module) where.module = params.module;
    if (params.action) where.action = params.action;
    if (params.dateFrom || params.dateTo) {
      where.createdAt = {};
      if (params.dateFrom) where.createdAt.gte = new Date(params.dateFrom);
      if (params.dateTo) where.createdAt.lte = new Date(params.dateTo);
    }
    return where;
  }

  // List entries. When skip/take are provided we return the paginated
  // envelope `{ data, total, hasMore }` used by the rest of the backend
  // (see branches / customers / suppliers services). Without them we keep
  // the legacy raw-array response so older callers don't break.
  async findAll(params: ListParams) {
    const where = this.buildWhere(params);
    const include = {
      user: { select: { id: true, name: true, email: true, role: true } },
    } as const;

    const isPaginated = params.skip !== undefined || params.take !== undefined;
    const safeSkip = Math.max(0, params.skip ?? 0);
    // Clamp take to a hard ceiling so an Export request can grab a big page
    // without exposing the DB to a single-call DOS.
    const safeTake = Math.min(Math.max(1, params.take ?? 50), 5000);

    if (!isPaginated) {
      // Legacy path — returns a raw array, capped at 100.
      return this.prisma.auditLog.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: safeSkip,
        take: safeTake,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total, hasMore: safeSkip + data.length < total };
  }

  // Aggregate counts for the summary tiles. Honors the same filters so the
  // tiles always reflect what the table is showing.
  async stats(params: ListParams) {
    const where = this.buildWhere(params);
    const [total, creates, updates, deletes] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.count({ where: { ...where, action: 'CREATE' } }),
      this.prisma.auditLog.count({ where: { ...where, action: 'UPDATE' } }),
      this.prisma.auditLog.count({ where: { ...where, action: 'DELETE' } }),
    ]);
    return { total, creates, updates, deletes };
  }
}
