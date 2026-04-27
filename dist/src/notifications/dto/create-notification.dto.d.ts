export declare enum NotificationType {
    LOW_STOCK = "LOW_STOCK",
    EXPIRY = "EXPIRY",
    PAYMENT_DUE = "PAYMENT_DUE",
    SYSTEM = "SYSTEM",
    APPROVAL = "APPROVAL"
}
export declare class CreateNotificationDto {
    type: NotificationType;
    title: string;
    message: string;
    actionUrl?: string;
    branchId?: string;
}
