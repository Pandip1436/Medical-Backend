export declare class CreateReminderDto {
    customerId: string;
    dayOfMonth: number;
    title: string;
    notes?: string;
    branchId?: string;
}
export declare class UpdateReminderDto {
    dayOfMonth?: number;
    title?: string;
    notes?: string;
}
export declare class CreateContactLogDto {
    status: string;
    notes?: string;
}
