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
let CreditNotesService = class CreditNotesService {
    prisma;
    approvalsService;
    constructor(prisma, approvalsService) {
        this.prisma = prisma;
        this.approvalsService = approvalsService;
    }
    async create(dto, userId, branchId, userRole) {
        if (userRole === 'PHARMACIST') {
            const invoice = await this.prisma.invoice.findUnique({ where: { id: dto.invoiceId } });
            if (!invoice)
                throw new common_1.NotFoundException('Invoice not found');
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
            for (const item of dto.items) {
                const invoiceItem = invoice.items.find((i) => i.productId === item.productId && i.batchId === item.batchId);
                if (!invoiceItem) {
                    throw new common_1.BadRequestException(`Item ${item.productName} (batch ${item.batchNumber}) not found on invoice`);
                }
                if (item.returnedQty > invoiceItem.quantity) {
                    throw new common_1.BadRequestException(`Cannot return ${item.returnedQty} of ${item.productName}; only ${invoiceItem.quantity} were sold`);
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
            const creditNoteNo = `CN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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
};
exports.CreditNotesService = CreditNotesService;
exports.CreditNotesService = CreditNotesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        approvals_service_1.ApprovalsService])
], CreditNotesService);
//# sourceMappingURL=credit-notes.service.js.map