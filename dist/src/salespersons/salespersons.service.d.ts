import { PrismaService } from '../prisma/prisma.service';
export declare class SalespersonsService {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(branchId?: string): Promise<{
        id: string;
        email: string;
        name: string;
        phone: string;
        isActive: boolean;
        lastLogin: Date | null;
        branchId: string | null;
        commissionRate: import("@prisma/client/runtime/library").Decimal;
        createdAt: Date;
    }[]>;
    getStats(id: string, branchId?: string): Promise<{
        totalInvoices: number;
        totalSales: number;
        commissionRate: number;
        commissionEarned: number;
    }>;
    getReport(branchId?: string, from?: string, to?: string): Promise<{
        salespersonId: string;
        name: string;
        isActive: boolean;
        invoiceCount: number;
        totalSales: number;
    }[]>;
}
