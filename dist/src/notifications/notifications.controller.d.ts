import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
export declare class NotificationsController {
    private readonly service;
    constructor(service: NotificationsService);
    findAll(req: any, queryBranchId?: string, unread?: string): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.NotificationType;
        title: string;
        message: string;
        isRead: boolean;
        actionUrl: string | null;
    }[]>;
    create(dto: CreateNotificationDto, req: any, queryBranchId?: string): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.NotificationType;
        title: string;
        message: string;
        isRead: boolean;
        actionUrl: string | null;
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
    }>;
    markAllAsRead(req: any, queryBranchId?: string): Promise<import(".prisma/client").Prisma.BatchPayload>;
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
    clearAll(req: any, queryBranchId?: string): Promise<import(".prisma/client").Prisma.BatchPayload>;
    generateLowStock(req: any, queryBranchId?: string): Promise<{
        created: number;
    }>;
    generateExpiry(req: any, queryBranchId?: string, days?: string): Promise<{
        created: number;
    }>;
    generatePaymentDue(req: any, queryBranchId?: string): Promise<{
        created: number;
    }>;
    generateAll(req: any, queryBranchId?: string): Promise<{
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
