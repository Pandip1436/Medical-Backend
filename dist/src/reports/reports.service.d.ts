import { PrismaService } from '../prisma/prisma.service';
export declare class ReportsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getDashboardKpis(): Promise<{
        monthlySales: number | import("@prisma/client/runtime/library").Decimal;
        todaysSales: number | import("@prisma/client/runtime/library").Decimal;
        totalOutstanding: number | import("@prisma/client/runtime/library").Decimal;
        expiringBatchesCount: number;
        lowStockAlertsCount: number;
        totalProducts: number;
        recentInvoices: ({
            items: {
                quantity: number;
                productName: string;
            }[];
        } & {
            id: string;
            createdAt: Date;
            type: import(".prisma/client").$Enums.InvoiceType;
            date: Date;
            invoiceNumber: string;
            billingType: import(".prisma/client").$Enums.BillingType;
            customerName: string;
            doctorName: string | null;
            subtotal: import("@prisma/client/runtime/library").Decimal;
            productDiscount: import("@prisma/client/runtime/library").Decimal;
            taxableAmount: import("@prisma/client/runtime/library").Decimal;
            cgst: import("@prisma/client/runtime/library").Decimal;
            sgst: import("@prisma/client/runtime/library").Decimal;
            igst: import("@prisma/client/runtime/library").Decimal;
            roundOff: import("@prisma/client/runtime/library").Decimal;
            grandTotal: import("@prisma/client/runtime/library").Decimal;
            paymentMode: import(".prisma/client").$Enums.PaymentMode;
            paymentDetails: import("@prisma/client/runtime/library").JsonValue | null;
            status: import(".prisma/client").$Enums.InvoiceStatus;
            amountPaid: import("@prisma/client/runtime/library").Decimal;
            changeReturned: import("@prisma/client/runtime/library").Decimal;
            customerId: string | null;
            createdById: string;
        })[];
    }>;
    getDailySales(): Promise<{
        chartData: {
            hour: string;
            amount: number;
        }[];
        tableData: {
            invoice: string;
            time: string;
            customer: string;
            amount: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getProductSales(): Promise<{
        chartData: {
            product: string;
            revenue: number;
            qtySold: number;
            margin: number;
        }[];
        tableData: {
            product: string;
            revenue: number;
            qtySold: number;
            margin: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getStockValuation(): Promise<{
        chartData: {
            category: string;
            value: number;
        }[];
        tableData: {
            product: string;
            batch: string;
            qty: number;
            purchaseValue: number;
            mrpValue: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
}
