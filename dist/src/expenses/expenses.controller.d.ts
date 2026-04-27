import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
export declare class ExpensesController {
    private readonly expensesService;
    constructor(expensesService: ExpensesService);
    create(dto: CreateExpenseDto, req: any, branchId?: string): Promise<{
        id: string;
        branchId: string | null;
        date: Date;
        description: string;
        category: string;
        paymentMode: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        receiptImage: string | null;
    }>;
    findAll(req: any, category?: string, from?: string, to?: string, branchId?: string): Promise<{
        amount: number;
        id: string;
        branchId: string | null;
        date: Date;
        description: string;
        category: string;
        paymentMode: string;
        receiptImage: string | null;
    }[]>;
    findOne(id: string, req: any): Promise<{
        amount: number;
        id: string;
        branchId: string | null;
        date: Date;
        description: string;
        category: string;
        paymentMode: string;
        receiptImage: string | null;
    }>;
    update(id: string, dto: UpdateExpenseDto, req: any): Promise<{
        amount: number;
        id: string;
        branchId: string | null;
        date: Date;
        description: string;
        category: string;
        paymentMode: string;
        receiptImage: string | null;
    }>;
    remove(id: string, req: any): Promise<{
        id: string;
        branchId: string | null;
        date: Date;
        description: string;
        category: string;
        paymentMode: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        receiptImage: string | null;
    }>;
}
