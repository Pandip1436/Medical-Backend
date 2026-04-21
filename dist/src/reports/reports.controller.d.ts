import { ReportsService } from './reports.service';
export declare class ReportsController {
    private readonly reportsService;
    constructor(reportsService: ReportsService);
    getDashboardKpis(req: any, branchId?: string): Promise<{
        monthlySales: number | import("@prisma/client/runtime/library").Decimal;
        todaysSales: number | import("@prisma/client/runtime/library").Decimal;
        totalOutstanding: number | import("@prisma/client/runtime/library").Decimal;
        expiringBatchesCount: number;
        lowStockAlertsCount: number;
        totalProducts: number;
        recentInvoices: ({
            items: {
                productName: string;
                quantity: number;
            }[];
        } & {
            id: string;
            branchId: string | null;
            createdAt: Date;
            date: Date;
            subtotal: import("@prisma/client/runtime/library").Decimal;
            cgst: import("@prisma/client/runtime/library").Decimal;
            sgst: import("@prisma/client/runtime/library").Decimal;
            igst: import("@prisma/client/runtime/library").Decimal;
            status: import(".prisma/client").$Enums.InvoiceStatus;
            createdById: string;
            type: import(".prisma/client").$Enums.InvoiceType;
            invoiceNumber: string;
            billingType: import(".prisma/client").$Enums.BillingType;
            customerName: string;
            doctorName: string | null;
            salespersonName: string | null;
            productDiscount: import("@prisma/client/runtime/library").Decimal;
            taxableAmount: import("@prisma/client/runtime/library").Decimal;
            roundOff: import("@prisma/client/runtime/library").Decimal;
            grandTotal: import("@prisma/client/runtime/library").Decimal;
            paymentMode: import(".prisma/client").$Enums.PaymentMode;
            paymentDetails: import("@prisma/client/runtime/library").JsonValue | null;
            amountPaid: import("@prisma/client/runtime/library").Decimal;
            changeReturned: import("@prisma/client/runtime/library").Decimal;
            customerId: string | null;
            doctorId: string | null;
            salespersonId: string | null;
        })[];
    }>;
    getDailySales(req: any, branchId?: string): Promise<{
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
    getMonthlySales(req: any, year?: string, branchId?: string): Promise<{
        year: number;
        chartData: {
            month: string;
            amount: number;
            invoices: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getYearlySales(req: any, branchId?: string): Promise<{
        chartData: {
            year: string;
            amount: number;
            invoices: number;
        }[];
    }>;
    getProductSales(req: any, from?: string, to?: string, branchId?: string): Promise<{
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
    getCategorySales(req: any, from?: string, to?: string, branchId?: string): Promise<{
        chartData: {
            category: string;
            qty: number;
            revenue: number;
        }[];
        tableData: {
            category: string;
            qty: number;
            revenue: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getCustomerSales(req: any, from?: string, to?: string, branchId?: string): Promise<{
        chartData: {
            customer: string;
            invoices: number;
            revenue: number;
        }[];
        tableData: {
            customer: string;
            invoices: number;
            revenue: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getPurchaseSummary(req: any, from?: string, to?: string, branchId?: string): Promise<{
        tableData: {
            date: Date;
            grnNumber: string;
            supplier: string;
            items: number;
            amount: number;
        }[];
        chartData: {
            month: string;
            amount: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getSupplierPurchase(req: any, from?: string, to?: string, branchId?: string): Promise<{
        chartData: {
            supplier: string;
            grns: number;
            amount: number;
        }[];
        tableData: {
            supplier: string;
            grns: number;
            amount: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getPurchaseVsSales(req: any, from?: string, to?: string, branchId?: string): Promise<{
        chartData: {
            month: string;
            sales: number;
            purchases: number;
        }[];
        tableData: {
            month: string;
            sales: number;
            purchases: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getStockValuation(req: any, branchId?: string): Promise<{
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
    getCurrentStock(req: any, branchId?: string): Promise<{
        chartData: {
            product: string;
            stock: number;
        }[];
        tableData: {
            product: string;
            category: import(".prisma/client").$Enums.ProductCategory;
            totalStock: number;
            minStock: number;
            mrp: number;
            status: string;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getAbcAnalysis(req: any, from?: string, to?: string, branchId?: string): Promise<{
        chartData: {
            category: string;
            count: number;
            revenue: number;
        }[];
        tableData: {
            cumPct: number;
            abc: string;
            product: string;
            revenue: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getStockMovement(req: any, from?: string, to?: string, branchId?: string): Promise<{
        tableData: {
            net: number;
            product: string;
            inQty: number;
            outQty: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getStockAging(req: any, branchId?: string): Promise<{
        chartData: {
            bucket: string;
            value: number;
        }[];
        tableData: {
            product: string;
            batch: string;
            qty: number;
            ageDays: number;
            bucket: "0-30" | "31-60" | "61-90" | "91-180" | "180+";
            value: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getExpiryReport(req: any, branchId?: string): Promise<{
        tableData: {
            product: any;
            batch: any;
            expiryDate: any;
            qty: any;
            mrpValue: number;
            purchaseValue: number;
            supplier: any;
            daysToExpiry: number;
            status: "EXPIRED" | "NEAR_EXPIRY";
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getProfitLoss(req: any, from?: string, to?: string, branchId?: string): Promise<{
        period: {
            from: Date;
            to: Date;
        };
        lineItems: ({
            label: string;
            amount: number;
            emphasis?: undefined;
        } | {
            label: string;
            amount: number;
            emphasis: boolean;
        })[];
        kpis: {
            label: string;
            value: string;
        }[];
        extras: {
            grossPurchases: number;
            purchaseReturn: number;
            totalTax: number;
        };
    }>;
    getCashBook(req: any, from?: string, to?: string, branchId?: string): Promise<{
        period: {
            from: Date;
            to: Date;
        };
        tableData: ({
            balance: number;
            date: Date;
            ref: string;
            description: string;
            amount: number;
            type: "RECEIPT";
        } | {
            balance: number;
            date: Date;
            ref: string;
            description: string;
            amount: number;
            type: "PAYMENT";
        })[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getOutstanding(req: any, branchId?: string): Promise<{
        tableData: {
            current: number;
            '0-30': number;
            '31-60': number;
            '61-90': number;
            '90+': number;
            customerId: string;
            customer: string;
            phone: string;
            creditLimit: number;
            outstanding: number;
        }[];
        agingSummary: {
            current: number;
            '0-30': number;
            '31-60': number;
            '61-90': number;
            '90+': number;
        };
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getCustomerLedger(customerId: string, from?: string, to?: string): Promise<{
        customer: null;
        tableData: never[];
        kpis: never[];
    } | {
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
            creditLimit: import("@prisma/client/runtime/library").Decimal;
            currentOutstanding: import("@prisma/client/runtime/library").Decimal;
            loyaltyPoints: number;
            dlNumber: string | null;
        };
        tableData: {
            balance: number;
            date: Date;
            ref: string;
            description: string;
            debit: number;
            credit: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getSupplierLedger(supplierId: string, from?: string, to?: string): Promise<{
        supplier: null;
        tableData: never[];
        kpis: never[];
    } | {
        supplier: {
            id: string;
            email: string;
            name: string;
            phone: string;
            isActive: boolean;
            branchId: string | null;
            address: string;
            gstin: string;
            drugLicense: string;
            contactPerson: string;
            paymentTerms: import(".prisma/client").$Enums.PaymentTerms;
            bankDetails: string | null;
        };
        tableData: {
            date: string;
            balance: number;
            ref: string;
            description: string;
            debit: number;
            credit: number;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getExpenseReport(req: any, from?: string, to?: string, branchId?: string): Promise<{
        chartData: {
            category: string;
            amount: number;
            count: number;
        }[];
        tableData: {
            date: Date;
            category: string;
            description: string;
            amount: number;
            paymentMode: string;
        }[];
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getGstr1(req: any, from?: string, to?: string, branchId?: string): Promise<{
        period: {
            from: Date;
            to: Date;
        };
        tableData: {
            gstRate: number;
            taxable: number;
            cgst: number;
            sgst: number;
            igst: number;
        }[];
        totals: {
            taxable: number;
            cgst: number;
            sgst: number;
            igst: number;
        };
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getGstr3b(req: any, from?: string, to?: string, branchId?: string): Promise<{
        period: {
            from: Date;
            to: Date;
        };
        outwardSupplies: {
            taxableValue: number;
            cgst: number;
            sgst: number;
            igst: number;
            totalTax: number;
        };
        inwardSupplies: {
            totalValue: number;
        };
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
    getHsnSummary(req: any, from?: string, to?: string, branchId?: string): Promise<{
        period: {
            from: Date;
            to: Date;
        };
        tableData: {
            hsn: string;
            uqc: string;
            qty: number;
            taxable: number;
            gstRate: number;
            tax: number;
        }[];
        totals: {
            taxable: number;
            tax: number;
            qty: number;
        };
        kpis: {
            label: string;
            value: string;
        }[];
    }>;
}
