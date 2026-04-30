import { ApprovalsService } from './approvals.service';
export declare class ApprovalsController {
    private readonly approvalsService;
    constructor(approvalsService: ApprovalsService);
    findAll(req: any, status?: string, type?: string): import(".prisma/client").Prisma.PrismaPromise<({
        requestedBy: {
            id: string;
            name: string;
            role: import(".prisma/client").$Enums.Role;
        };
        reviewedBy: {
            id: string;
            name: string;
        } | null;
    } & {
        id: string;
        branchId: string | null;
        createdAt: Date;
        status: import(".prisma/client").$Enums.ApprovalStatus;
        type: import(".prisma/client").$Enums.ApprovalType;
        updatedAt: Date;
        requestedAt: Date;
        reviewedAt: Date | null;
        reviewNote: string | null;
        payload: import("@prisma/client/runtime/library").JsonValue;
        refId: string | null;
        requestedById: string;
        reviewedById: string | null;
    })[]>;
    pendingCount(req: any): Promise<{
        count: number;
    }>;
    findOne(id: string): import(".prisma/client").Prisma.Prisma__ApprovalRequestClient<({
        requestedBy: {
            id: string;
            name: string;
            role: import(".prisma/client").$Enums.Role;
        };
        reviewedBy: {
            id: string;
            name: string;
        } | null;
    } & {
        id: string;
        branchId: string | null;
        createdAt: Date;
        status: import(".prisma/client").$Enums.ApprovalStatus;
        type: import(".prisma/client").$Enums.ApprovalType;
        updatedAt: Date;
        requestedAt: Date;
        reviewedAt: Date | null;
        reviewNote: string | null;
        payload: import("@prisma/client/runtime/library").JsonValue;
        refId: string | null;
        requestedById: string;
        reviewedById: string | null;
    }) | null, null, import("@prisma/client/runtime/library").DefaultArgs>;
    approve(id: string, body: {
        reviewNote?: string;
    }, req: any): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        status: import(".prisma/client").$Enums.ApprovalStatus;
        type: import(".prisma/client").$Enums.ApprovalType;
        updatedAt: Date;
        requestedAt: Date;
        reviewedAt: Date | null;
        reviewNote: string | null;
        payload: import("@prisma/client/runtime/library").JsonValue;
        refId: string | null;
        requestedById: string;
        reviewedById: string | null;
    }>;
    reject(id: string, body: {
        reviewNote: string;
    }, req: any): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        status: import(".prisma/client").$Enums.ApprovalStatus;
        type: import(".prisma/client").$Enums.ApprovalType;
        updatedAt: Date;
        requestedAt: Date;
        reviewedAt: Date | null;
        reviewNote: string | null;
        payload: import("@prisma/client/runtime/library").JsonValue;
        refId: string | null;
        requestedById: string;
        reviewedById: string | null;
    }>;
}
