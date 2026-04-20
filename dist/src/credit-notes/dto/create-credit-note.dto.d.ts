import { SettlementMode } from '@prisma/client';
import { CreateCreditNoteItemDto } from './create-credit-note-item.dto';
export declare class CreateCreditNoteDto {
    invoiceId: string;
    reason: string;
    items: CreateCreditNoteItemDto[];
    subtotal: number;
    cgst?: number;
    sgst?: number;
    igst?: number;
    totalAmount: number;
    settlementMode?: SettlementMode;
    notes?: string;
    branchId?: string;
}
