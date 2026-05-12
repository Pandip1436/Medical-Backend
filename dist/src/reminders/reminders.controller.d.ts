import { RemindersService } from './reminders.service';
import { CreateReminderDto, UpdateReminderDto, CreateContactLogDto } from './dto/reminder.dto';
export declare class RemindersController {
    private readonly service;
    constructor(service: RemindersService);
    findAll(req: any): Promise<({
        customer: {
            id: string;
            email: string | null;
            name: string;
            phone: string;
            type: import(".prisma/client").$Enums.CustomerType;
        };
        contacts: {
            id: string;
            status: import(".prisma/client").$Enums.ReminderContactStatus;
            notes: string | null;
            contactedAt: Date;
            reminderId: string;
        }[];
    } & {
        id: string;
        branchId: string | null;
        createdAt: Date;
        notes: string | null;
        updatedAt: Date;
        customerId: string;
        title: string;
        dayOfMonth: number;
    })[]>;
    findDueToday(req: any): Promise<({
        customer: {
            id: string;
            email: string | null;
            name: string;
            phone: string;
            type: import(".prisma/client").$Enums.CustomerType;
        };
        contacts: {
            id: string;
            status: import(".prisma/client").$Enums.ReminderContactStatus;
            notes: string | null;
            contactedAt: Date;
            reminderId: string;
        }[];
    } & {
        id: string;
        branchId: string | null;
        createdAt: Date;
        notes: string | null;
        updatedAt: Date;
        customerId: string;
        title: string;
        dayOfMonth: number;
    })[]>;
    create(dto: CreateReminderDto, req: any): Promise<{
        customer: {
            id: string;
            email: string | null;
            name: string;
            phone: string;
            type: import(".prisma/client").$Enums.CustomerType;
        };
        contacts: {
            id: string;
            status: import(".prisma/client").$Enums.ReminderContactStatus;
            notes: string | null;
            contactedAt: Date;
            reminderId: string;
        }[];
    } & {
        id: string;
        branchId: string | null;
        createdAt: Date;
        notes: string | null;
        updatedAt: Date;
        customerId: string;
        title: string;
        dayOfMonth: number;
    }>;
    update(id: string, dto: UpdateReminderDto, req: any): Promise<{
        customer: {
            id: string;
            email: string | null;
            name: string;
            phone: string;
            type: import(".prisma/client").$Enums.CustomerType;
        };
        contacts: {
            id: string;
            status: import(".prisma/client").$Enums.ReminderContactStatus;
            notes: string | null;
            contactedAt: Date;
            reminderId: string;
        }[];
    } & {
        id: string;
        branchId: string | null;
        createdAt: Date;
        notes: string | null;
        updatedAt: Date;
        customerId: string;
        title: string;
        dayOfMonth: number;
    }>;
    remove(id: string, req: any): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        notes: string | null;
        updatedAt: Date;
        customerId: string;
        title: string;
        dayOfMonth: number;
    }>;
    addContactLog(id: string, dto: CreateContactLogDto, req: any): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.ReminderContactStatus;
        notes: string | null;
        contactedAt: Date;
        reminderId: string;
    }>;
    getContactLogs(id: string, req: any): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.ReminderContactStatus;
        notes: string | null;
        contactedAt: Date;
        reminderId: string;
    }[]>;
}
