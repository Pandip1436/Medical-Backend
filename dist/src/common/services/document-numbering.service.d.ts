import { Prisma } from '@prisma/client';
export type DocType = 'PO' | 'GRN' | 'DN' | 'INV' | 'CN' | 'QTN' | 'RCPT' | 'ADJ';
export declare class DocumentNumberingService {
    static getFinancialYear(date?: Date): string;
    nextNumber(tx: Prisma.TransactionClient, docType: DocType, branchId?: string | null): Promise<string>;
}
