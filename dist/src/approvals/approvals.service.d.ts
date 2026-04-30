import { PrismaService } from '../prisma/prisma.service';
import { ApprovalType } from '@prisma/client';
export declare class ApprovalsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    createRequest(opts: {
        type: ApprovalType;
        payload: Record<string, any>;
        requestedById: string;
        branchId?: string;
        refId?: string;
    }): Promise<{
        requestedBy: {
            id: string;
            name: string;
            role: import(".prisma/client").$Enums.Role;
        };
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
    }>;
    findAll(opts: {
        branchId?: string;
        status?: string;
        type?: string;
        userId?: string;
        role?: string;
    }): import(".prisma/client").Prisma.PrismaPromise<({
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
    approve(id: string, reviewedById: string, reviewNote?: string): Promise<{
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
    reject(id: string, reviewedById: string, reviewNote: string): Promise<{
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
    countPending(branchId?: string): import(".prisma/client").Prisma.PrismaPromise<number>;
    private executeApprovedAction;
}
