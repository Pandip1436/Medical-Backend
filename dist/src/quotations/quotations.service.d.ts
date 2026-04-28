import { PrismaService } from '../prisma/prisma.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
export declare class QuotationsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateQuotationDto): Promise<{
        items: {
            id: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            productId: string | null;
            productName: string;
            batchNumber: string | null;
            quantity: number;
            batchId: string | null;
            rate: import("@prisma/client/runtime/library").Decimal;
            discountPercent: import("@prisma/client/runtime/library").Decimal;
            gstPercent: import("@prisma/client/runtime/library").Decimal;
            amount: import("@prisma/client/runtime/library").Decimal;
            quotationId: string;
        }[];
    } & {
        id: string;
        createdAt: Date;
        date: Date;
        subtotal: import("@prisma/client/runtime/library").Decimal;
        cgst: import("@prisma/client/runtime/library").Decimal;
        sgst: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.QuotationStatus;
        notes: string | null;
        updatedAt: Date;
        customerName: string;
        customerId: string | null;
        total: import("@prisma/client/runtime/library").Decimal;
        validUntil: Date | null;
        quotationNumber: string;
    }>;
    findAll(filters: {
        q?: string;
        fromDate?: string;
        toDate?: string;
        status?: string;
        amountMin?: number;
        amountMax?: number;
    }): Promise<({
        items: {
            id: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            productId: string | null;
            productName: string;
            batchNumber: string | null;
            quantity: number;
            batchId: string | null;
            rate: import("@prisma/client/runtime/library").Decimal;
            discountPercent: import("@prisma/client/runtime/library").Decimal;
            gstPercent: import("@prisma/client/runtime/library").Decimal;
            amount: import("@prisma/client/runtime/library").Decimal;
            quotationId: string;
        }[];
    } & {
        id: string;
        createdAt: Date;
        date: Date;
        subtotal: import("@prisma/client/runtime/library").Decimal;
        cgst: import("@prisma/client/runtime/library").Decimal;
        sgst: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.QuotationStatus;
        notes: string | null;
        updatedAt: Date;
        customerName: string;
        customerId: string | null;
        total: import("@prisma/client/runtime/library").Decimal;
        validUntil: Date | null;
        quotationNumber: string;
    })[]>;
    findOne(id: string): Promise<{
        items: {
            id: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            productId: string | null;
            productName: string;
            batchNumber: string | null;
            quantity: number;
            batchId: string | null;
            rate: import("@prisma/client/runtime/library").Decimal;
            discountPercent: import("@prisma/client/runtime/library").Decimal;
            gstPercent: import("@prisma/client/runtime/library").Decimal;
            amount: import("@prisma/client/runtime/library").Decimal;
            quotationId: string;
        }[];
        customer: {
            id: string;
            email: string | null;
            name: string;
            phone: string;
            branchId: string | null;
            createdAt: Date;
            notes: string | null;
            address: string | null;
            gstin: string | null;
            alternatePhone: string | null;
            type: import(".prisma/client").$Enums.CustomerType;
            doctorRef: string | null;
            referredBy: string | null;
            creditLimit: import("@prisma/client/runtime/library").Decimal;
            currentOutstanding: import("@prisma/client/runtime/library").Decimal;
            loyaltyPoints: number;
            dlNumber: string | null;
        } | null;
    } & {
        id: string;
        createdAt: Date;
        date: Date;
        subtotal: import("@prisma/client/runtime/library").Decimal;
        cgst: import("@prisma/client/runtime/library").Decimal;
        sgst: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.QuotationStatus;
        notes: string | null;
        updatedAt: Date;
        customerName: string;
        customerId: string | null;
        total: import("@prisma/client/runtime/library").Decimal;
        validUntil: Date | null;
        quotationNumber: string;
    }>;
    update(id: string, data: any): Promise<{
        items: {
            id: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            productId: string | null;
            productName: string;
            batchNumber: string | null;
            quantity: number;
            batchId: string | null;
            rate: import("@prisma/client/runtime/library").Decimal;
            discountPercent: import("@prisma/client/runtime/library").Decimal;
            gstPercent: import("@prisma/client/runtime/library").Decimal;
            amount: import("@prisma/client/runtime/library").Decimal;
            quotationId: string;
        }[];
    } & {
        id: string;
        createdAt: Date;
        date: Date;
        subtotal: import("@prisma/client/runtime/library").Decimal;
        cgst: import("@prisma/client/runtime/library").Decimal;
        sgst: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.QuotationStatus;
        notes: string | null;
        updatedAt: Date;
        customerName: string;
        customerId: string | null;
        total: import("@prisma/client/runtime/library").Decimal;
        validUntil: Date | null;
        quotationNumber: string;
    }>;
    updateStatus(id: string, status: string): Promise<{
        items: {
            id: string;
            mrp: import("@prisma/client/runtime/library").Decimal;
            productId: string | null;
            productName: string;
            batchNumber: string | null;
            quantity: number;
            batchId: string | null;
            rate: import("@prisma/client/runtime/library").Decimal;
            discountPercent: import("@prisma/client/runtime/library").Decimal;
            gstPercent: import("@prisma/client/runtime/library").Decimal;
            amount: import("@prisma/client/runtime/library").Decimal;
            quotationId: string;
        }[];
    } & {
        id: string;
        createdAt: Date;
        date: Date;
        subtotal: import("@prisma/client/runtime/library").Decimal;
        cgst: import("@prisma/client/runtime/library").Decimal;
        sgst: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.QuotationStatus;
        notes: string | null;
        updatedAt: Date;
        customerName: string;
        customerId: string | null;
        total: import("@prisma/client/runtime/library").Decimal;
        validUntil: Date | null;
        quotationNumber: string;
    }>;
    remove(id: string): Promise<{
        id: string;
        createdAt: Date;
        date: Date;
        subtotal: import("@prisma/client/runtime/library").Decimal;
        cgst: import("@prisma/client/runtime/library").Decimal;
        sgst: import("@prisma/client/runtime/library").Decimal;
        status: import(".prisma/client").$Enums.QuotationStatus;
        notes: string | null;
        updatedAt: Date;
        customerName: string;
        customerId: string | null;
        total: import("@prisma/client/runtime/library").Decimal;
        validUntil: Date | null;
        quotationNumber: string;
    }>;
    getStats(): Promise<{
        total: number;
        totalCount: number;
        acceptedTotal: number;
        acceptedCount: number;
        pendingTotal: number;
        pendingCount: number;
        rejectedCount: number;
    }>;
}
