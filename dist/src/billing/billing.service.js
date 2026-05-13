"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const approvals_service_1 = require("../approvals/approvals.service");
const document_numbering_service_1 = require("../common/services/document-numbering.service");
let BillingService = class BillingService {
    prisma;
    approvalsService;
    numbering;
    constructor(prisma, approvalsService, numbering) {
        this.prisma = prisma;
        this.approvalsService = approvalsService;
        this.numbering = numbering;
    }
    async assertPrescriptionForScheduledItems(tx, items, customerId, billingType) {
        if (!items.length)
            return;
        if (billingType && billingType.toUpperCase() === 'WHOLESALE')
            return;
        const productIds = items.map((i) => i.productId);
        const products = await tx.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true, schedule: true },
        });
        const scheduledProducts = products.filter((p) => p.schedule === 'H' || p.schedule === 'H1' || p.schedule === 'X');
        if (scheduledProducts.length === 0)
            return;
        if (!customerId) {
            const names = scheduledProducts.map((p) => p.name).join(', ');
            throw new common_1.BadRequestException(`Schedule H/H1/X drugs (${names}) cannot be sold to a walk-in customer — record the customer and their prescription first.`);
        }
        const activeRx = await tx.prescription.findFirst({
            where: {
                customerId,
                isActive: true,
                OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
            },
            select: { id: true },
        });
        if (!activeRx) {
            const names = scheduledProducts.map((p) => p.name).join(', ');
            throw new common_1.BadRequestException(`Cannot dispense ${names} — customer has no active, non-expired prescription on file.`);
        }
    }
    async deductStockForItem(tx, item, branchId) {
        const batch = await tx.batch.findUnique({ where: { id: item.batchId } });
        if (!batch) {
            throw new common_1.NotFoundException(`Batch ${item.batchNumber} for product ${item.productName} not found`);
        }
        const expiry = new Date(batch.expiryDate);
        expiry.setHours(23, 59, 59, 999);
        if (expiry < new Date()) {
            throw new common_1.BadRequestException(`Cannot sell ${item.productName} from batch ${item.batchNumber}: expired on ${new Date(batch.expiryDate).toLocaleDateString('en-IN')}`);
        }
        if (batch.quantity < item.quantity) {
            throw new common_1.BadRequestException(`Insufficient stock for ${item.productName} in batch ${item.batchNumber}. Available: ${batch.quantity}`);
        }
        await tx.batch.update({
            where: { id: batch.id },
            data: { quantity: batch.quantity - item.quantity },
        });
        const updatedProduct = await tx.product.update({
            where: { id: item.productId },
            data: { totalStock: { decrement: item.quantity } },
            select: {
                id: true,
                name: true,
                totalStock: true,
                minStock: true,
                branchId: true,
            },
        });
        const isLow = updatedProduct.totalStock <= 0 ||
            (updatedProduct.minStock > 0 &&
                updatedProduct.totalStock <= updatedProduct.minStock);
        if (isLow) {
            const now = new Date();
            const dedupSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const resolvedSince = new Date(now.getTime() - 30 * 86_400_000);
            const readSince = new Date(now.getTime() - 3 * 86_400_000);
            const alreadyNotified = await tx.notification.findFirst({
                where: {
                    type: 'LOW_STOCK',
                    message: { contains: `[productId:${updatedProduct.id}]` },
                    OR: [
                        { isRead: false, resolvedAt: null, snoozedUntil: null },
                        { isRead: false, resolvedAt: null, snoozedUntil: { gt: now } },
                        { resolvedAt: { gte: resolvedSince } },
                        { isRead: true, resolvedAt: null, createdAt: { gte: readSince } },
                        { createdAt: { gte: dedupSince } },
                    ],
                },
            });
            if (!alreadyNotified) {
                const stockLabel = updatedProduct.totalStock <= 0
                    ? 'is out of stock'
                    : `has only ${updatedProduct.totalStock} units left (min: ${updatedProduct.minStock})`;
                await tx.notification.create({
                    data: {
                        type: 'LOW_STOCK',
                        title: 'Low Stock Alert',
                        message: `${updatedProduct.name} ${stockLabel}. [productId:${updatedProduct.id}]`,
                        actionUrl: `/inventory/product-history?productId=${updatedProduct.id}`,
                        branchId: updatedProduct.branchId ?? branchId ?? null,
                    },
                });
            }
        }
    }
    async create(createInvoiceDto, userId, branchId, userRole) {
        const maxPendingCredit = Number(process.env.MAX_PENDING_CREDIT ?? 3);
        return this.prisma.$transaction(async (tx) => {
            if (createInvoiceDto.type === 'INVOICE' &&
                createInvoiceDto.paymentMode === 'CREDIT' &&
                createInvoiceDto.customerId) {
                const pendingCount = await tx.invoice.count({
                    where: {
                        customerId: createInvoiceDto.customerId,
                        status: { in: ['CREDIT', 'PARTIAL'] },
                    },
                });
                if (pendingCount >= maxPendingCredit) {
                    if (userRole === 'PHARMACIST') {
                        const invoiceNumber = await this.numbering.nextNumber(tx, 'INV', branchId ?? null);
                        const draftInvoice = await tx.invoice.create({
                            data: {
                                invoiceNumber,
                                type: createInvoiceDto.type,
                                billingType: createInvoiceDto.billingType,
                                branchId,
                                customerId: createInvoiceDto.customerId ?? null,
                                customerName: createInvoiceDto.customerName,
                                doctorName: createInvoiceDto.doctorName ?? null,
                                salespersonId: createInvoiceDto.salespersonId ?? null,
                                salespersonName: createInvoiceDto.salespersonName ?? null,
                                subtotal: createInvoiceDto.subtotal,
                                productDiscount: createInvoiceDto.productDiscount ?? 0,
                                taxableAmount: createInvoiceDto.taxableAmount ?? createInvoiceDto.subtotal,
                                cgst: createInvoiceDto.cgst ?? 0,
                                sgst: createInvoiceDto.sgst ?? 0,
                                igst: createInvoiceDto.igst ?? 0,
                                roundOff: createInvoiceDto.roundOff ?? 0,
                                grandTotal: createInvoiceDto.grandTotal,
                                paymentMode: 'CREDIT',
                                status: 'DRAFT',
                                amountPaid: 0,
                                changeReturned: 0,
                                createdById: userId,
                                items: {
                                    create: createInvoiceDto.items.map(item => ({
                                        productId: item.productId,
                                        productName: item.productName,
                                        batchId: item.batchId,
                                        batchNumber: item.batchNumber,
                                        expiryDate: new Date(item.expiryDate),
                                        quantity: item.quantity,
                                        rate: item.rate,
                                        mrp: item.mrp,
                                        amount: item.amount,
                                        gstPercent: item.gstPercent ?? 0,
                                        discountPercent: item.discountPercent ?? 0,
                                    })),
                                },
                            },
                        });
                        await this.approvalsService.createRequest({
                            type: 'CREDIT_BILL',
                            payload: { invoiceId: draftInvoice.id, invoiceNumber, pendingCount, customerId: createInvoiceDto.customerId, customerName: createInvoiceDto.customerName, grandTotal: createInvoiceDto.grandTotal },
                            requestedById: userId,
                            branchId,
                            refId: draftInvoice.id,
                        });
                        return { approvalRequested: true, approvalRequestId: draftInvoice.id, invoiceId: draftInvoice.id, invoiceNumber, status: 'DRAFT' };
                    }
                    throw new common_1.BadRequestException(`Customer has ${pendingCount} unpaid credit invoice(s). Please collect payment before adding more credit sales.`);
                }
            }
            const isQuotation = createInvoiceDto.type === 'QUOTATION';
            const invoiceNumber = await this.numbering.nextNumber(tx, isQuotation ? 'QTN' : 'INV', branchId ?? null);
            if (!isQuotation) {
                await this.assertPrescriptionForScheduledItems(tx, createInvoiceDto.items, createInvoiceDto.customerId ?? null, createInvoiceDto.billingType);
                for (const item of createInvoiceDto.items) {
                    await this.deductStockForItem(tx, item, branchId);
                }
            }
            const invoice = await tx.invoice.create({
                data: {
                    invoiceNumber,
                    type: createInvoiceDto.type,
                    billingType: createInvoiceDto.billingType,
                    branchId,
                    customerId: createInvoiceDto.customerId,
                    customerName: createInvoiceDto.customerName,
                    doctorName: createInvoiceDto.doctorName,
                    subtotal: createInvoiceDto.subtotal,
                    productDiscount: createInvoiceDto.productDiscount,
                    taxableAmount: createInvoiceDto.taxableAmount,
                    cgst: createInvoiceDto.cgst,
                    sgst: createInvoiceDto.sgst,
                    igst: createInvoiceDto.igst || 0,
                    roundOff: createInvoiceDto.roundOff,
                    grandTotal: createInvoiceDto.grandTotal,
                    paymentMode: createInvoiceDto.paymentMode,
                    paymentDetails: createInvoiceDto.paymentDetails,
                    status: createInvoiceDto.status,
                    amountPaid: createInvoiceDto.amountPaid,
                    changeReturned: createInvoiceDto.changeReturned,
                    salespersonId: createInvoiceDto.salespersonId ?? null,
                    salespersonName: createInvoiceDto.salespersonName ?? null,
                    createdById: userId,
                    items: {
                        create: createInvoiceDto.items.map(item => ({
                            productId: item.productId,
                            productName: item.productName,
                            batchId: item.batchId,
                            batchNumber: item.batchNumber,
                            expiryDate: new Date(item.expiryDate),
                            quantity: item.quantity,
                            mrp: item.mrp,
                            rate: item.rate,
                            discountPercent: item.discountPercent,
                            gstPercent: item.gstPercent,
                            amount: item.amount
                        }))
                    }
                },
                include: {
                    items: true
                }
            });
            if ((createInvoiceDto.paymentMode === 'CREDIT' || createInvoiceDto.paymentMode === 'SPLIT') && createInvoiceDto.customerId) {
                const amountAddedToCredit = createInvoiceDto.grandTotal - createInvoiceDto.amountPaid;
                if (amountAddedToCredit > 0) {
                    await tx.customer.update({
                        where: { id: createInvoiceDto.customerId },
                        data: { currentOutstanding: { increment: amountAddedToCredit } }
                    });
                }
            }
            if (createInvoiceDto.type === 'INVOICE' && createInvoiceDto.customerId) {
                const pointsEarned = Math.floor(Number(createInvoiceDto.grandTotal) / 100);
                if (pointsEarned > 0) {
                    await tx.customer.update({
                        where: { id: createInvoiceDto.customerId },
                        data: { loyaltyPoints: { increment: pointsEarned } },
                    });
                }
            }
            if (!isQuotation && createInvoiceDto.paymentMode === 'CREDIT') {
                const outstanding = Number(createInvoiceDto.grandTotal) - Number(createInvoiceDto.amountPaid);
                await tx.notification.create({
                    data: {
                        type: 'PAYMENT_DUE',
                        title: 'Payment Due',
                        message: `Invoice ${invoiceNumber} for ${createInvoiceDto.customerName} has ₹${outstanding.toFixed(2)} outstanding. [invoiceId:${invoice.id}]`,
                        actionUrl: `/customers/invoices/detail?id=${invoice.id}`,
                        branchId: branchId ?? null,
                    },
                });
            }
            return invoice;
        });
    }
    findAll(query, customerId, branchId, type) {
        const where = {};
        if (customerId)
            where.customerId = customerId;
        if (branchId)
            where.branchId = branchId;
        if (type)
            where.type = type;
        if (query) {
            where.OR = [
                { invoiceNumber: { contains: query, mode: 'insensitive' } },
                { customerName: { contains: query, mode: 'insensitive' } },
            ];
        }
        return this.prisma.invoice.findMany({
            where,
            include: { items: true },
            orderBy: { date: 'desc' },
            take: 100,
        });
    }
    async findOne(id, branchId) {
        const invoice = await this.prisma.invoice.findUnique({
            where: { id },
            include: { items: true, createdBy: { select: { name: true } } }
        });
        if (!invoice)
            throw new common_1.NotFoundException('Invoice not found');
        if (branchId && invoice.branchId && invoice.branchId !== branchId) {
            throw new common_1.NotFoundException('Invoice not found');
        }
        return invoice;
    }
    async convertToInvoice(id, branchId) {
        return this.prisma.$transaction(async (tx) => {
            const quotation = await tx.invoice.findUnique({
                where: { id },
                include: { items: true },
            });
            if (!quotation)
                throw new common_1.NotFoundException('Quotation not found');
            if (branchId && quotation.branchId && quotation.branchId !== branchId) {
                throw new common_1.NotFoundException('Quotation not found');
            }
            if (quotation.type !== 'QUOTATION') {
                throw new common_1.BadRequestException('Only QUOTATION type records can be converted');
            }
            await this.assertPrescriptionForScheduledItems(tx, quotation.items.map((i) => ({ productId: i.productId, productName: i.productName })), quotation.customerId ?? null, quotation.billingType);
            for (const item of quotation.items) {
                await this.deductStockForItem(tx, {
                    productId: item.productId,
                    productName: item.productName,
                    batchId: item.batchId,
                    batchNumber: item.batchNumber,
                    quantity: item.quantity,
                }, branchId);
            }
            const invoiceNumber = await this.numbering.nextNumber(tx, 'INV', branchId ?? null);
            return tx.invoice.update({
                where: { id },
                data: { type: 'INVOICE', invoiceNumber, status: 'PAID' },
                include: { items: true },
            });
        });
    }
    async collectPayment(id, amountReceived, paymentMode, branchId) {
        return this.prisma.$transaction(async (tx) => {
            const invoice = await tx.invoice.findUnique({ where: { id } });
            if (!invoice)
                throw new common_1.NotFoundException('Invoice not found');
            if (branchId && invoice.branchId && invoice.branchId !== branchId) {
                throw new common_1.NotFoundException('Invoice not found');
            }
            const outstanding = Number(invoice.grandTotal) - Number(invoice.amountPaid);
            if (outstanding <= 0) {
                throw new common_1.BadRequestException('Invoice is already fully paid');
            }
            if (amountReceived <= 0) {
                throw new common_1.BadRequestException('Payment amount must be greater than zero');
            }
            const newAmountPaid = Number(invoice.amountPaid) + amountReceived;
            const stillDue = Number(invoice.grandTotal) - newAmountPaid;
            const newStatus = stillDue <= 0.01 ? 'PAID' : 'PARTIAL';
            const updated = await tx.invoice.update({
                where: { id },
                data: {
                    amountPaid: newAmountPaid,
                    paymentMode: paymentMode,
                    status: newStatus,
                },
                include: { items: true },
            });
            if (invoice.customerId) {
                await tx.customer.update({
                    where: { id: invoice.customerId },
                    data: { currentOutstanding: { decrement: amountReceived } },
                });
                const receiptNumber = await this.numbering.nextNumber(tx, 'RCPT', invoice.branchId ?? branchId ?? null);
                await tx.payment.create({
                    data: {
                        receiptNumber,
                        customerId: invoice.customerId,
                        invoiceId: id,
                        amount: amountReceived,
                        paymentMode,
                        branchId: invoice.branchId ?? null,
                    },
                });
            }
            return updated;
        });
    }
    async update(id, data, branchId) {
        const invoice = await this.prisma.invoice.findUnique({ where: { id } });
        if (!invoice)
            throw new common_1.NotFoundException('Invoice not found');
        if (branchId && invoice.branchId && invoice.branchId !== branchId) {
            throw new common_1.NotFoundException('Invoice not found');
        }
        return this.prisma.invoice.update({ where: { id }, data });
    }
    async remove(id, branchId) {
        const invoice = await this.prisma.invoice.findUnique({ where: { id } });
        if (!invoice)
            throw new common_1.NotFoundException('Invoice not found');
        if (branchId && invoice.branchId && invoice.branchId !== branchId) {
            throw new common_1.NotFoundException('Invoice not found');
        }
        const deletable = invoice.status === 'CANCELLED'
            || (invoice.type === 'QUOTATION' && invoice.status === 'DRAFT');
        if (!deletable) {
            throw new common_1.BadRequestException(`Cannot delete invoice ${invoice.invoiceNumber} (status: ${invoice.status}). Cancel it first; deletion is reserved for cancelled invoices and unconverted quotations.`);
        }
        return this.prisma.invoice.delete({ where: { id } });
    }
    async exportTallyXml(fromDate, toDate, branchId) {
        const where = { type: 'INVOICE' };
        if (branchId)
            where.branchId = branchId;
        if (fromDate || toDate) {
            where.date = {};
            if (fromDate)
                where.date.gte = new Date(fromDate);
            if (toDate)
                where.date.lte = new Date(toDate);
        }
        const invoices = await this.prisma.invoice.findMany({
            where,
            include: { items: true },
            orderBy: { date: 'asc' },
        });
        const vouchers = invoices.map((inv) => {
            const dateStr = new Date(inv.date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '');
            const ledgerEntries = inv.items.map((item) => `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${this.escXml(item.productName)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-${Number(item.amount).toFixed(2)}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`).join('');
            return `
    <VOUCHER VCHTYPE="Sales" ACTION="Create">
      <DATE>${dateStr}</DATE>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${this.escXml(inv.invoiceNumber)}</VOUCHERNUMBER>
      <PARTYLEDGERNAME>${this.escXml(inv.customerName)}</PARTYLEDGERNAME>
      <EFFECTIVEDATE>${dateStr}</EFFECTIVEDATE>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${this.escXml(inv.customerName)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${Number(inv.grandTotal).toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      ${ledgerEntries}
    </VOUCHER>`;
        });
        return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          ${vouchers.join('')}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
    }
    escXml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
    async exportCsv(fromDate, toDate, branchId) {
        const where = { type: 'INVOICE' };
        if (branchId)
            where.branchId = branchId;
        if (fromDate || toDate) {
            where.date = {};
            if (fromDate)
                where.date.gte = new Date(fromDate);
            if (toDate)
                where.date.lte = new Date(toDate);
        }
        const invoices = await this.prisma.invoice.findMany({
            where,
            include: { items: true },
            orderBy: { date: 'asc' },
        });
        const rows = [
            'Invoice No,Date,Customer,Payment Mode,Subtotal,Discount,Taxable,CGST,SGST,Grand Total,Status',
        ];
        for (const inv of invoices) {
            rows.push([
                inv.invoiceNumber,
                new Date(inv.date).toLocaleDateString('en-IN'),
                `"${inv.customerName}"`,
                inv.paymentMode,
                Number(inv.subtotal).toFixed(2),
                Number(inv.productDiscount).toFixed(2),
                Number(inv.taxableAmount).toFixed(2),
                Number(inv.cgst).toFixed(2),
                Number(inv.sgst).toFixed(2),
                Number(inv.grandTotal).toFixed(2),
                inv.status,
            ].join(','));
        }
        return rows.join('\n');
    }
};
exports.BillingService = BillingService;
exports.BillingService = BillingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        approvals_service_1.ApprovalsService,
        document_numbering_service_1.DocumentNumberingService])
], BillingService);
//# sourceMappingURL=billing.service.js.map