import { GrnService } from './grn.service';
import { CreateGrnDto } from './dto/create-grn.dto';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
export declare class GrnController {
    private readonly grnService;
    constructor(grnService: GrnService);
    create(createGrnDto: CreateGrnDto, req: AuthenticatedRequest, branchId?: string): Promise<{
        items: {
            id: string;
            grnId: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            purchaseRate: import("@prisma/client/runtime/library").Decimal;
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
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.GRNStatus;
        grnNumber: string;
        poId: string | null;
        supplierInvoiceNo: string;
        supplierInvoiceDate: Date;
        supplierInvoiceAmount: import("@prisma/client/runtime/library").Decimal;
        isReplacement: boolean;
    }>;
    findAll(req: AuthenticatedRequest, q?: string, branchId?: string, page?: string, pageSize?: string): Promise<({
        items: {
            id: string;
            grnId: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            purchaseRate: import("@prisma/client/runtime/library").Decimal;
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
                purchaseRate: import("@prisma/client/runtime/library").Decimal;
                productId: string;
                productName: string;
                batchNumber: string;
                expiryDate: Date;
                batchId: string;
                gstPercent: import("@prisma/client/runtime/library").Decimal;
                amount: import("@prisma/client/runtime/library").Decimal;
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
            subtotal: import("@prisma/client/runtime/library").Decimal;
            cgst: import("@prisma/client/runtime/library").Decimal;
            sgst: import("@prisma/client/runtime/library").Decimal;
            igst: import("@prisma/client/runtime/library").Decimal;
            totalAmount: import("@prisma/client/runtime/library").Decimal;
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
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.GRNStatus;
        grnNumber: string;
        poId: string | null;
        supplierInvoiceNo: string;
        supplierInvoiceDate: Date;
        supplierInvoiceAmount: import("@prisma/client/runtime/library").Decimal;
        isReplacement: boolean;
    })[] | {
        items: ({
            items: {
                id: string;
                grnId: string;
                mrp: import("@prisma/client/runtime/library").Decimal;
                purchaseRate: import("@prisma/client/runtime/library").Decimal;
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
                    purchaseRate: import("@prisma/client/runtime/library").Decimal;
                    productId: string;
                    productName: string;
                    batchNumber: string;
                    expiryDate: Date;
                    batchId: string;
                    gstPercent: import("@prisma/client/runtime/library").Decimal;
                    amount: import("@prisma/client/runtime/library").Decimal;
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
                subtotal: import("@prisma/client/runtime/library").Decimal;
                cgst: import("@prisma/client/runtime/library").Decimal;
                sgst: import("@prisma/client/runtime/library").Decimal;
                igst: import("@prisma/client/runtime/library").Decimal;
                totalAmount: import("@prisma/client/runtime/library").Decimal;
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
            totalAmount: import("@prisma/client/runtime/library").Decimal;
            status: import(".prisma/client").$Enums.GRNStatus;
            grnNumber: string;
            poId: string | null;
            supplierInvoiceNo: string;
            supplierInvoiceDate: Date;
            supplierInvoiceAmount: import("@prisma/client/runtime/library").Decimal;
            isReplacement: boolean;
        })[];
        total: number;
        page: number;
        pageSize: number;
    }>;
    backfill(): Promise<{
        message: string;
    }>;
    backfillGrnOrdered(): Promise<{
        message: string;
    }>;
    backfillSupplierOutstanding(): Promise<{
        message: string;
    }>;
    backfillPoStatusDN(): Promise<{
        message: string;
    }>;
    reverseShortDeliveryStock(): Promise<{
        message: string;
        fixed: {
            debitNoteNo: string;
            reason: string;
            items: number;
        }[];
        skipped: number;
    }>;
    findOne(id: string, req: AuthenticatedRequest): Promise<{
        items: {
            id: string;
            grnId: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            purchaseRate: import("@prisma/client/runtime/library").Decimal;
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
        totalAmount: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.GRNStatus;
        grnNumber: string;
        poId: string | null;
        supplierInvoiceNo: string;
        supplierInvoiceDate: Date;
        supplierInvoiceAmount: import("@prisma/client/runtime/library").Decimal;
        isReplacement: boolean;
    }>;
}
