import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

const METHOD_TO_ACTION: Record<string, string> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

const SKIP_PATH_FRAGMENTS = ['/auth/login', '/auth/register', '/audit-logs'];

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;
    const action = METHOD_TO_ACTION[method];

    if (!action) return next.handle();
    if (SKIP_PATH_FRAGMENTS.some((f) => req.url?.includes(f))) return next.handle();

    return next.handle().pipe(
      tap(async (response) => {
        const userId = req.user?.userId;
        if (!userId) return;

        const segments = (req.url || '').split('?')[0].split('/').filter(Boolean);
        const apiIdx = segments.indexOf('api');
        const moduleSegment = segments[apiIdx + 2] || segments[segments.length - 1] || 'unknown';
        const idCandidate = segments[apiIdx + 3];
        const entityId =
          (response && typeof response === 'object' && (response.id ?? null)) || idCandidate || null;

        try {
          await this.prisma.auditLog.create({
            data: {
              userId,
              module: moduleSegment,
              action,
              entity: moduleSegment,
              entityId,
              newValue: action === 'DELETE' ? undefined : (req.body ?? undefined),
              ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
            },
          });
        } catch {
          // Don't break the request if audit logging fails
        }
      }),
    );
  }
}
