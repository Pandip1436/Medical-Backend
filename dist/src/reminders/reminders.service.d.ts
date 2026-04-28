import { PrismaService } from '../prisma/prisma.service';
import { CreateReminderDto, UpdateReminderDto, CreateContactLogDto } from './dto/reminder.dto';
export declare class RemindersService {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(branchId?: string): Promise<({
        customer: {
            id: string;
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
    findDueToday(branchId?: string): Promise<({
        customer: {
            id: string;
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
    create(dto: CreateReminderDto): Promise<{
        customer: {
            id: string;
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
    update(id: string, dto: UpdateReminderDto): Promise<{
        customer: {
            id: string;
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
    remove(id: string): Promise<{
        id: string;
        branchId: string | null;
        createdAt: Date;
        notes: string | null;
        updatedAt: Date;
        customerId: string;
        title: string;
        dayOfMonth: number;
    }>;
    addContactLog(reminderId: string, dto: CreateContactLogDto): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.ReminderContactStatus;
        notes: string | null;
        contactedAt: Date;
        reminderId: string;
    }>;
    getContactLogs(reminderId: string): Promise<{
        id: string;
        status: import(".prisma/client").$Enums.ReminderContactStatus;
        notes: string | null;
        contactedAt: Date;
        reminderId: string;
    }[]>;
}
