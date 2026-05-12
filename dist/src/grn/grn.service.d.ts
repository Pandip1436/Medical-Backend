import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { CreateGrnDto } from './dto/create-grn.dto';
export declare class GrnService {
    private readonly prisma;
    private readonly numbering;
    constructor(prisma: PrismaService, numbering: DocumentNumberingService);
    create(createGrnDto: CreateGrnDto, branchId?: string): Promise<{
        items: {
            id: string;
            grnId: string;
            mrp: Prisma.Decimal;
            purchaseRate: Prisma.Decimal;
            productId: string;
            productName: string;
            receivedQty: number;
            orderedQty: number;
            freeQty: number;
            batchNumber: string;
            mfgDate: Date;
            expiryDate: Date;
            damageQty: number;
        }[];
    } & {
        id: string;
        branchId: string | null;
        date: Date;
        supplierId: string;
        supplierName: string;
        totalAmount: Prisma.Decimal;
        status: import(".prisma/client").$Enums.GRNStatus;
        grnNumber: string;
        poId: string | null;
        supplierInvoiceNo: string;
        supplierInvoiceDate: Date;
        supplierInvoiceAmount: Prisma.Decimal;
        isReplacement: boolean;
    }>;
    findAll(query?: string, branchId?: string, page?: number, pageSize?: number): Promise<({
        items: {
            id: string;
            grnId: string;
            mrp: Prisma.Decimal;
            purchaseRate: Prisma.Decimal;
            productId: string;
            productName: string;
            receivedQty: number;
            orderedQty: number;
            freeQty: number;
            batchNumber: string;
            mfgDate: Date;
            expiryDate: Date;
            damageQty: number;
        }[];
        purchaseReturns: ({
            items: {
                id: string;
                purchaseRate: Prisma.Decimal;
                productId: string;
                productName: string;
                batchNumber: string;
                expiryDate: Date;
                batchId: string;
                gstPercent: Prisma.Decimal;
                amount: Prisma.Decimal;
                returnedQty: number;
                purchaseReturnId: string;
            }[];
        } & {
            id: string;
            branchId: string | null;
            createdAt: Date;
            debitNoteNo: string;
            date: Date;
            grnId: string | null;
            supplierId: string;
            supplierName: string;
            reason: string;
            subtotal: Prisma.Decimal;
            cgst: Prisma.Decimal;
            sgst: Prisma.Decimal;
            igst: Prisma.Decimal;
            totalAmount: Prisma.Decimal;
            status: import(".prisma/client").$Enums.PurchaseReturnStatus;
            settlementMode: import(".prisma/client").$Enums.PurchaseReturnSettlement;
            replacementGrnId: string | null;
            notes: string | null;
            createdById: string;
            stockReversedAt: Date | null;
        })[];
    } & {
        id: string;
        branchId: string | null;
        date: Date;
        supplierId: string;
        supplierName: string;
        totalAmount: Prisma.Decimal;
        status: import(".prisma/client").$Enums.GRNStatus;
        grnNumber: string;
        poId: string | null;
        supplierInvoiceNo: string;
        supplierInvoiceDate: Date;
        supplierInvoiceAmount: Prisma.Decimal;
        isReplacement: boolean;
    })[] | {
        items: ({
            items: {
                id: string;
                grnId: string;
                mrp: Prisma.Decimal;
                purchaseRate: Prisma.Decimal;
                productId: string;
                productName: string;
                receivedQty: number;
                orderedQty: number;
                freeQty: number;
                batchNumber: string;
                mfgDate: Date;
                expiryDate: Date;
                damageQty: number;
            }[];
            purchaseReturns: ({
                items: {
                    id: string;
                    purchaseRate: Prisma.Decimal;
                    productId: string;
                    productName: string;
                    batchNumber: string;
                    expiryDate: Date;
                    batchId: string;
                    gstPercent: Prisma.Decimal;
                    amount: Prisma.Decimal;
                    returnedQty: number;
                    purchaseReturnId: string;
                }[];
            } & {
                id: string;
                branchId: string | null;
                createdAt: Date;
                debitNoteNo: string;
                date: Date;
                grnId: string | null;
                supplierId: string;
                supplierName: string;
                reason: string;
                subtotal: Prisma.Decimal;
                cgst: Prisma.Decimal;
                sgst: Prisma.Decimal;
                igst: Prisma.Decimal;
                totalAmount: Prisma.Decimal;
                status: import(".prisma/client").$Enums.PurchaseReturnStatus;
                settlementMode: import(".prisma/client").$Enums.PurchaseReturnSettlement;
                replacementGrnId: string | null;
                notes: string | null;
                createdById: string;
                stockReversedAt: Date | null;
            })[];
        } & {
            id: string;
            branchId: string | null;
            date: Date;
            supplierId: string;
            supplierName: string;
            totalAmount: Prisma.Decimal;
            status: import(".prisma/client").$Enums.GRNStatus;
            grnNumber: string;
            poId: string | null;
            supplierInvoiceNo: string;
            supplierInvoiceDate: Date;
            supplierInvoiceAmount: Prisma.Decimal;
            isReplacement: boolean;
        })[];
        total: number;
        page: number;
        pageSize: number;
    }>;
    reverseShortDeliveryStockDeduction(): Promise<{
        message: string;
        fixed: {
            debitNoteNo: string;
            reason: string;
            items: number;
        }[];
        skipped: number;
    }>;
    backfillPoStatusWithDebitNotes(): Promise<{
        message: string;
    }>;
    backfillSupplierOutstanding(): Promise<{
        message: string;
    }>;
    backfillGrnOrderedQty(): Promise<{
        message: string;
    }>;
    backfillPoReceivedQty(): Promise<{
        message: string;
    }>;
    findOne(id: string, branchId?: string): Promise<{
        items: {
            id: string;
            grnId: string;
            mrp: Prisma.Decimal;
            purchaseRate: Prisma.Decimal;
            productId: string;
            productName: string;
            receivedQty: number;
            orderedQty: number;
            freeQty: number;
            batchNumber: string;
            mfgDate: Date;
            expiryDate: Date;
            damageQty: number;
        }[];
    } & {
        id: string;
        branchId: string | null;
        date: Date;
        supplierId: string;
        supplierName: string;
        totalAmount: Prisma.Decimal;
        status: import(".prisma/client").$Enums.GRNStatus;
        grnNumber: string;
        poId: string | null;
        supplierInvoiceNo: string;
        supplierInvoiceDate: Date;
        supplierInvoiceAmount: Prisma.Decimal;
        isReplacement: boolean;
    }>;
}
