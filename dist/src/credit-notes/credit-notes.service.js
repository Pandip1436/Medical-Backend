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
exports.CreditNotesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const approvals_service_1 = require("../approvals/approvals.service");
const document_numbering_service_1 = require("../common/services/document-numbering.service");
let CreditNotesService = class CreditNotesService {
    prisma;
    approvalsService;
    numbering;
    constructor(prisma, approvalsService, numbering) {
        this.prisma = prisma;
        this.approvalsService = approvalsService;
        this.numbering = numbering;
    }
    async create(dto, userId, branchId, userRole) {
        if (userRole === 'PHARMACIST') {
            const invoice = await this.prisma.invoice.findUnique({
                where: { id: dto.invoiceId },
                include: { items: true },
            });
            if (!invoice)
                throw new common_1.NotFoundException('Invoice not found');
            const returnedSoFar = await this.getReturnedQtyByInvoice(invoice.id, branchId);
            const priorByKey = new Map();
            for (const r of returnedSoFar) {
                priorByKey.set(`${r.productId}::${r.batchId}`, r.alreadyReturned);
            }
            for (const item of dto.items) {
                const sold = invoice.items.find((i) => i.productId === item.productId && i.batchId === item.batchId);
                if (!sold) {
                    throw new common_1.BadRequestException(`Item ${item.productName} (batch ${item.batchNumber}) not found on invoice`);
                }
                const alreadyReturned = priorByKey.get(`${item.productId}::${item.batchId}`) ?? 0;
                const remaining = sold.quantity - alreadyReturned;
                if (item.returnedQty > remaining) {
                    throw new common_1.BadRequestException(`Cannot return ${item.returnedQty} of ${item.productName}: only ${remaining} unreturned (sold ${sold.quantity}, already returned/pending ${alreadyReturned})`);
                }
            }
            const req = await this.approvalsService.createRequest({
                type: 'SALES_RETURN',
                payload: {
                    ...dto,
                    invoiceNumber: invoice.invoiceNumber,
                    customerId: invoice.customerId,
                    customerName: invoice.customerName,
                    createdById: userId,
                },
                requestedById: userId,
                branchId: branchId ?? invoice.branchId ?? undefined,
            });
            return { approvalRequested: true, approvalRequestId: req.id };
        }
        return this.prisma.$transaction(async (tx) => {
            const invoice = await tx.invoice.findUnique({
                where: { id: dto.invoiceId },
                include: { items: true, customer: true },
            });
            if (!invoice)
                throw new common_1.NotFoundException('Invoice not found');
            if (branchId && invoice.branchId && invoice.branchId !== branchId) {
                throw new common_1.NotFoundException('Invoice not found');
            }
            const priorReturns = await tx.creditNoteItem.findMany({
                where: { creditNote: { invoiceId: invoice.id } },
                select: { productId: true, batchId: true, returnedQty: true },
            });
            const priorByKey = new Map();
            for (const r of priorReturns) {
                const k = `${r.productId}::${r.batchId}`;
                priorByKey.set(k, (priorByKey.get(k) ?? 0) + r.returnedQty);
            }
            for (const item of dto.items) {
                const invoiceItem = invoice.items.find((i) => i.productId === item.productId && i.batchId === item.batchId);
                if (!invoiceItem) {
                    throw new common_1.BadRequestException(`Item ${item.productName} (batch ${item.batchNumber}) not found on invoice`);
                }
                const alreadyReturned = priorByKey.get(`${item.productId}::${item.batchId}`) ?? 0;
                const remaining = invoiceItem.quantity - alreadyReturned;
                if (item.returnedQty > remaining) {
                    throw new common_1.BadRequestException(`Cannot return ${item.returnedQty} of ${item.productName}: only ${remaining} unreturned (sold ${invoiceItem.quantity}, already returned ${alreadyReturned})`);
                }
                await tx.batch.update({
                    where: { id: item.batchId },
                    data: { quantity: { increment: item.returnedQty } },
                });
                await tx.product.update({
                    where: { id: item.productId },
                    data: { totalStock: { increment: item.returnedQty } },
                });
            }
            const creditNoteNo = await this.numbering.nextNumber(tx, 'CN', invoice.branchId ?? branchId ?? null);
            const settlementMode = dto.settlementMode ?? 'REFUND';
            const creditNote = await tx.creditNote.create({
                data: {
                    creditNoteNo,
                    branchId: invoice.branchId,
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.invoiceNumber,
                    customerId: invoice.customerId,
                    customerName: invoice.customerName,
                    reason: dto.reason,
                    subtotal: dto.subtotal,
                    cgst: dto.cgst ?? 0,
                    sgst: dto.sgst ?? 0,
                    igst: dto.igst ?? 0,
                    totalAmount: dto.totalAmount,
                    settlementMode,
                    settledAt: settlementMode === 'CREDIT' ? new Date() : null,
                    notes: dto.notes,
                    createdById: userId,
                    items: {
                        create: dto.items.map((it) => ({
                            productId: it.productId,
                            productName: it.productName,
                            batchId: it.batchId,
                            batchNumber: it.batchNumber,
                            expiryDate: new Date(it.expiryDate),
                            returnedQty: it.returnedQty,
                            rate: it.rate,
                            gstPercent: it.gstPercent,
                            amount: it.amount,
                        })),
                    },
                },
                include: { items: true },
            });
            if (settlementMode === 'CREDIT' && invoice.customerId) {
                await tx.customer.update({
                    where: { id: invoice.customerId },
                    data: { currentOutstanding: { decrement: dto.totalAmount } },
                });
            }
            const totalReturnedSoFar = await tx.creditNote.aggregate({
                where: { invoiceId: invoice.id },
                _sum: { totalAmount: true },
            });
            const returned = Number(totalReturnedSoFar._sum.totalAmount ?? 0);
            if (returned >= Number(invoice.grandTotal)) {
                await tx.invoice.update({
                    where: { id: invoice.id },
                    data: { status: 'RETURNED' },
                });
            }
            return creditNote;
        });
    }
    findAll(query, customerId, branchId) {
        const where = {};
        if (customerId)
            where.customerId = customerId;
        if (branchId)
            where.branchId = branchId;
        if (query) {
            where.OR = [
                { creditNoteNo: { contains: query, mode: 'insensitive' } },
                { invoiceNumber: { contains: query, mode: 'insensitive' } },
                { customerName: { contains: query, mode: 'insensitive' } },
            ];
        }
        return this.prisma.creditNote.findMany({
            where,
            orderBy: { date: 'desc' },
            take: 100,
        });
    }
    async findOne(id, branchId) {
        const cn = await this.prisma.creditNote.findUnique({
            where: { id },
            include: { items: true, invoice: true },
        });
        if (!cn)
            throw new common_1.NotFoundException('Credit note not found');
        if (branchId && cn.branchId && cn.branchId !== branchId) {
            throw new common_1.NotFoundException('Credit note not found');
        }
        return cn;
    }
    async getReturnedQtyByInvoice(invoiceId, branchId) {
        const invoice = await this.prisma.invoice.findUnique({
            where: { id: invoiceId },
            select: { id: true, branchId: true },
        });
        if (!invoice)
            throw new common_1.NotFoundException('Invoice not found');
        if (branchId && invoice.branchId && invoice.branchId !== branchId) {
            throw new common_1.NotFoundException('Invoice not found');
        }
        const approved = await this.prisma.creditNoteItem.findMany({
            where: { creditNote: { invoiceId } },
            select: { productId: true, batchId: true, returnedQty: true },
        });
        const pending = await this.prisma.approvalRequest.findMany({
            where: { type: 'SALES_RETURN', status: 'PENDING' },
            select: { payload: true },
        });
        const totals = new Map();
        for (const r of approved) {
            const k = `${r.productId}::${r.batchId}`;
            totals.set(k, (totals.get(k) ?? 0) + r.returnedQty);
        }
        for (const req of pending) {
            const payload = req.payload;
            if (payload?.invoiceId !== invoiceId)
                continue;
            for (const it of payload.items ?? []) {
                const k = `${it.productId}::${it.batchId}`;
                totals.set(k, (totals.get(k) ?? 0) + Number(it.returnedQty ?? 0));
            }
        }
        return Array.from(totals.entries()).map(([key, alreadyReturned]) => {
            const [productId, batchId] = key.split('::');
            return { productId, batchId, alreadyReturned };
        });
    }
};
exports.CreditNotesService = CreditNotesService;
exports.CreditNotesService = CreditNotesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        approvals_service_1.ApprovalsService,
        document_numbering_service_1.DocumentNumberingService])
], CreditNotesService);
//# sourceMappingURL=credit-notes.service.js.map