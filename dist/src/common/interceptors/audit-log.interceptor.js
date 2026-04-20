"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLogInterceptor = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const prisma_service_1 = require("../../prisma/prisma.service");
const METHOD_TO_ACTION = {
    POST: 'CREATE',
    PUT: 'UPDATE',
    PATCH: 'UPDATE',
    DELETE: 'DELETE',
};
const SKIP_PATH_FRAGMENTS = ['/auth/login', '/auth/register', '/audit-logs'];
let AuditLogInterceptor = class AuditLogInterceptor {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    intercept(context, next) {
        const req = context.switchToHttp().getRequest();
        const method = req.method;
        const action = METHOD_TO_ACTION[method];
        if (!action)
            return next.handle();
        if (SKIP_PATH_FRAGMENTS.some((f) => req.url?.includes(f)))
            return next.handle();
        return next.handle().pipe((0, rxjs_1.tap)(async (response) => {
            const userId = req.user?.userId;
            if (!userId)
                return;
            const segments = (req.url || '').split('?')[0].split('/').filter(Boolean);
            const apiIdx = segments.indexOf('api');
            const moduleSegment = segments[apiIdx + 2] || segments[segments.length - 1] || 'unknown';
            const idCandidate = segments[apiIdx + 3];
            const entityId = (response && typeof response === 'object' && (response.id ?? null)) || idCandidate || null;
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
            }
            catch {
            }
        }));
    }
};
exports.AuditLogInterceptor = AuditLogInterceptor;
exports.AuditLogInterceptor = AuditLogInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AuditLogInterceptor);
//# sourceMappingURL=audit-log.interceptor.js.map