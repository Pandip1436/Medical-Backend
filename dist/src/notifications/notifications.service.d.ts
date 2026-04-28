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
    }>;
    markAllAsRead(branchId?: string): Promise<import(".prisma/client").Prisma.BatchPayload>;
    remove(id: string): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.NotificationType;
        title: string;
        message: string;
        isRead: boolean;
        actionUrl: string | null;
    }>;
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
