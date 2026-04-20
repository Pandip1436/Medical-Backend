import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query?: string, limit = 100) {
    if (query) {
      return this.prisma.auditLog.findMany({
        where: {
          OR: [
            { module: { contains: query, mode: 'insensitive' } },
            { action: { contains: query, mode: 'insensitive' } },
            { entity: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: { user: { select: { name: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }
    return this.prisma.auditLog.findMany({
      include: { user: { select: { name: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
