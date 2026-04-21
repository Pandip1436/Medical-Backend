import { SalespersonsService } from './salespersons.service';
import { UsersService } from '../users/users.service';
declare class CreateSalespersonDto {
    name: string;
    email: string;
    phone: string;
    password: string;
    branchId: string;
}
declare class UpdateSalespersonDto {
    name?: string;
    email?: string;
    phone?: string;
    password?: string;
    branchId?: string;
}
export declare class SalespersonsController {
    private readonly salespersonsService;
    private readonly usersService;
    constructor(salespersonsService: SalespersonsService, usersService: UsersService);
    findAll(branchId?: string): Promise<{
        id: string;
        name: string;
        email: string;
        phone: string;
        isActive: boolean;
        lastLogin: Date | null;
        branchId: string | null;
        commissionRate: import("@prisma/client/runtime/library").Decimal;
        createdAt: Date;
    }[]>;
    create(dto: CreateSalespersonDto): Promise<{
        id: string;
        name: string;
        email: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        lastLogin: Date | null;
        branchId: string | null;
        createdAt: Date;
        branch: {
            id: string;
            name: string;
            code: string;
        } | null;
    }>;
    update(id: string, dto: UpdateSalespersonDto, req: any): Promise<{
        id: string;
        name: string;
        email: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        branchId: string | null;
        branch: {
            id: string;
            name: string;
            code: string;
        } | null;
    }>;
    toggle(id: string, req: any): Promise<{
        id: string;
        name: string;
        email: string;
        phone: string;
        role: import(".prisma/client").$Enums.Role;
        isActive: boolean;
        branchId: string | null;
        branch: {
            id: string;
            name: string;
            code: string;
        } | null;
    }>;
    getReport(branchId?: string, from?: string, to?: string): Promise<{
        salespersonId: string;
        name: string;
        isActive: boolean;
        invoiceCount: number;
        totalSales: number;
    }[]>;
    getStats(id: string, branchId?: string): Promise<{
        totalInvoices: number;
        totalSales: number;
        commissionRate: number;
        commissionEarned: number;
    }>;
}
export {};
