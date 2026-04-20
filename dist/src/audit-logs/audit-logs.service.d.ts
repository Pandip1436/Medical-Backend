import { PrismaService } from '../prisma/prisma.service';
export declare class AuditLogsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(query?: string, limit?: number): import(".prisma/client").Prisma.PrismaPromise<({
        user: {
            email: string;
            name: string;
            role: import(".prisma/client").$Enums.Role;
        };
    } & {
        id: string;
        createdAt: Date;
        userId: string;
        module: string;
        action: string;
        entity: string;
        entityId: string | null;
        oldValue: import("@prisma/client/runtime/library").JsonValue | null;
        newValue: import("@prisma/client/runtime/library").JsonValue | null;
        ipAddress: string | null;
    })[]>;
}
