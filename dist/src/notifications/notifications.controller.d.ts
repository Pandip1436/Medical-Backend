import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
export declare class NotificationsController {
    private readonly service;
    constructor(service: NotificationsService);
    findAll(req: AuthenticatedRequest, queryBranchId?: string, unread?: string): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.NotificationType;
        title: string;
        message: string;
        isRead: boolean;
        actionUrl: string | null;
        snoozedUntil: Date | null;
        resolvedAt: Date | null;
        resolvedById: string | null;
        entityState: import("@prisma/client/runtime/library").JsonValue | null;
    }[]>;
    create(dto: CreateNotificationDto, req: AuthenticatedRequest, queryBranchId?: string): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.NotificationType;
        title: string;
        message: string;
        isRead: boolean;
        actionUrl: string | null;
        snoozedUntil: Date | null;
        resolvedAt: Date | null;
        resolvedById: string | null;
        entityState: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    markAsRead(id: string): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.NotificationType;
        title: string;
        message: string;
        isRead: boolean;
        actionUrl: string | null;
        snoozedUntil: Date | null;
        resolvedAt: Date | null;
        resolvedById: string | null;
        entityState: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    markAllAsRead(req: AuthenticatedRequest, queryBranchId?: string): Promise<import(".prisma/client").Prisma.BatchPayload>;
    markManyAsRead(body: {
        ids: string[];
    }): Promise<import(".prisma/client").Prisma.BatchPayload>;
    snooze(id: string, body: {
        until: string;
    }): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.NotificationType;
        title: string;
        message: string;
        isRead: boolean;
        actionUrl: string | null;
        snoozedUntil: Date | null;
        resolvedAt: Date | null;
        resolvedById: string | null;
        entityState: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    resolve(id: string, req: AuthenticatedRequest): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.NotificationType;
        title: string;
        message: string;
        isRead: boolean;
        actionUrl: string | null;
        snoozedUntil: Date | null;
        resolvedAt: Date | null;
        resolvedById: string | null;
        entityState: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    remove(id: string): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.NotificationType;
        title: string;
        message: string;
        isRead: boolean;
        actionUrl: string | null;
        snoozedUntil: Date | null;
        resolvedAt: Date | null;
        resolvedById: string | null;
        entityState: import("@prisma/client/runtime/library").JsonValue | null;
    }>;
    removeMany(body: {
        ids: string[];
    }): Promise<import(".prisma/client").Prisma.BatchPayload>;
    clearAll(req: AuthenticatedRequest, queryBranchId?: string): Promise<import(".prisma/client").Prisma.BatchPayload>;
    generateLowStock(req: AuthenticatedRequest, queryBranchId?: string): Promise<{
        created: number;
    }>;
    generateExpiry(req: AuthenticatedRequest, queryBranchId?: string, days?: string): Promise<{
        created: number;
    }>;
    generatePaymentDue(req: AuthenticatedRequest, queryBranchId?: string): Promise<{
        created: number;
    }>;
    generateAll(req: AuthenticatedRequest, queryBranchId?: string): Promise<{
        lowStock: {
            created: number;
        };
        expiry: {
            created: number;
        };
        paymentDue: {
            created: number;
        };
    }>;
}
