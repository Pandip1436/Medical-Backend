import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
export declare class ExpensesService {
    private prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateExpenseDto, branchId?: string): Promise<{
        id: string;
        branchId: string | null;
        date: Date;
        category: string;
        paymentMode: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        description: string;
        receiptImage: string | null;
    }>;
    findAll(category?: string, from?: string, to?: string, branchId?: string): Promise<{
        amount: number;
        id: string;
        branchId: string | null;
        date: Date;
        category: string;
        paymentMode: string;
        description: string;
        receiptImage: string | null;
    }[]>;
    findOne(id: string, branchId?: string): Promise<{
        amount: number;
        id: string;
        branchId: string | null;
        date: Date;
        category: string;
        paymentMode: string;
        description: string;
        receiptImage: string | null;
    }>;
    update(id: string, dto: UpdateExpenseDto, branchId?: string): Promise<{
        amount: number;
        id: string;
        branchId: string | null;
        date: Date;
        category: string;
        paymentMode: string;
        description: string;
        receiptImage: string | null;
    }>;
    remove(id: string, branchId?: string): Promise<{
        id: string;
        branchId: string | null;
        date: Date;
        category: string;
        paymentMode: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        description: string;
        receiptImage: string | null;
    }>;
}
