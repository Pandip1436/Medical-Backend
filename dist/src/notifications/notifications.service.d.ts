import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
export declare class NotificationsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateNotificationDto): Promise<{
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
    findAll(branchId?: string, onlyUnread?: boolean): Promise<{
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
    markAllAsRead(branchId?: string): Promise<import(".prisma/client").Prisma.BatchPayload>;
    markManyAsRead(ids: string[]): Promise<import(".prisma/client").Prisma.BatchPayload>;
    snooze(id: string, until: Date): Promise<{
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
    resolve(id: string, userId?: string): Promise<{
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
    removeMany(ids: string[]): Promise<import(".prisma/client").Prisma.BatchPayload>;
    clearAll(branchId?: string): Promise<import(".prisma/client").Prisma.BatchPayload>;
    generateLowStockAlerts(branchId?: string): Promise<{
        created: number;
    }>;
    generateExpiryAlerts(branchId?: string, daysAhead?: number): Promise<{
        created: number;
    }>;
    generateReminderAlerts(): Promise<{
        created: number;
    }>;
    generatePaymentDueAlerts(branchId?: string): Promise<{
        created: number;
    }>;
}
