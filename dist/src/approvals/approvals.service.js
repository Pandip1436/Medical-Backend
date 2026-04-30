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
exports.ApprovalsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ApprovalsService = class ApprovalsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createRequest(opts) {
        const request = await this.prisma.approvalRequest.create({
            data: {
                type: opts.type,
                payload: opts.payload,
                requestedById: opts.requestedById,
                branchId: opts.branchId ?? null,
                refId: opts.refId ?? null,
            },
            include: { requestedBy: { select: { id: true, name: true, role: true } } },
        });
        await this.prisma.notification.create({
            data: {
                type: 'APPROVAL',
                title: 'Approval Required',
                message: `${request.requestedBy.name} requested approval for ${opts.type.replace(/_/g, ' ').toLowerCase()}.`,
                actionUrl: '/admin/approvals',
                branchId: opts.branchId ?? null,
            },
        });
        return request;
    }
    findAll(opts) {
        const where = {};
        if (opts.branchId)
            where.branchId = opts.branchId;
        if (opts.status)
            where.status = opts.status;
        if (opts.type)
            where.type = opts.type;
        if (opts.role !== 'ADMIN')
            where.requestedById = opts.userId;
        return this.prisma.approvalRequest.findMany({
            where,
            orderBy: { requestedAt: 'desc' },
            include: {
                requestedBy: { select: { id: true, name: true, role: true } },
                reviewedBy: { select: { id: true, name: true } },
            },
        });
    }
    findOne(id) {
        return this.prisma.approvalRequest.findUnique({
            where: { id },
            include: {
                requestedBy: { select: { id: true, name: true, role: true } },
                reviewedBy: { select: { id: true, name: true } },
            },
        });
    }
    async approve(id, reviewedById, reviewNote) {
        const req = await this.prisma.approvalRequest.findUnique({ where: { id } });
        if (!req)
            throw new common_1.NotFoundException('Approval request not found');
        if (req.status !== 'PENDING')
            throw new common_1.BadRequestException('Request is no longer pending');
        const updated = await this.prisma.approvalRequest.update({
            where: { id },
            data: { status: 'APPROVED', reviewedById, reviewedAt: new Date(), reviewNote: reviewNote ?? null },
        });
        await this.executeApprovedAction(req.type, req.payload, req.refId, req.branchId);
        await this.prisma.notification.create({
            data: {
                type: 'APPROVAL',
                title: 'Request Approved',
                message: `Your ${req.type.replace(/_/g, ' ').toLowerCase()} request has been approved.${reviewNote ? ` Note: ${reviewNote}` : ''}`,
                actionUrl: '/admin/approvals',
                branchId: req.branchId ?? null,
            },
        });
        return updated;
    }
    async reject(id, reviewedById, reviewNote) {
        const req = await this.prisma.approvalRequest.findUnique({ where: { id } });
        if (!req)
            throw new common_1.NotFoundException('Approval request not found');
        if (req.status !== 'PENDING')
            throw new common_1.BadRequestException('Request is no longer pending');
        const updated = await this.prisma.approvalRequest.update({
            where: { id },
            data: { status: 'REJECTED', reviewedById, reviewedAt: new Date(), reviewNote },
        });
        if (req.type === 'CREDIT_BILL' && req.refId) {
            await this.prisma.invoice.update({
                where: { id: req.refId },
                data: { status: 'CANCELLED' },
            }).catch(() => { });
        }
        await this.prisma.notification.create({
            data: {
                type: 'APPROVAL',
                title: 'Request Rejected',
                message: `Your ${req.type.replace(/_/g, ' ').toLowerCase()} request was rejected.${reviewNote ? ` Reason: ${reviewNote}` : ''}`,
                actionUrl: '/admin/approvals',
                branchId: req.branchId ?? null,
            },
        });
        return updated;
    }
    countPending(branchId) {
        return this.prisma.approvalRequest.count({
            where: { status: 'PENDING', ...(branchId ? { branchId } : {}) },
        });
    }
    async executeApprovedAction(type, payload, refId, branchId) {
        switch (type) {
            case 'NEW_CUSTOMER': {
                await this.prisma.customer.create({ data: { ...payload, branchId: branchId ?? null } });
                break;
            }
            case 'CREDIT_BILL': {
                if (refId) {
                    await this.prisma.invoice.update({
                        where: { id: refId },
                        data: { status: 'CREDIT' },
                    });
                    const invoice = await this.prisma.invoice.findUnique({ where: { id: refId } });
                    if (invoice?.customerId) {
                        await this.prisma.customer.update({
                            where: { id: invoice.customerId },
                            data: { currentOutstanding: { increment: invoice.grandTotal } },
                        });
                    }
                }
                break;
            }
            case 'SALES_RETURN': {
                const creditNoteNo = `CN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                await this.prisma.$transaction(async (tx) => {
                    for (const item of payload.items ?? []) {
                        await tx.batch.update({ where: { id: item.batchId }, data: { quantity: { increment: item.returnedQty } } });
                        await tx.product.update({ where: { id: item.productId }, data: { totalStock: { increment: item.returnedQty } } });
                    }
                    await tx.creditNote.create({
                        data: {
                            creditNoteNo,
                            invoiceId: payload.invoiceId,
                            invoiceNumber: payload.invoiceNumber,
                            customerId: payload.customerId,
                            customerName: payload.customerName,
                            reason: payload.reason,
                            subtotal: payload.subtotal,
                            cgst: payload.cgst ?? 0,
                            sgst: payload.sgst ?? 0,
                            igst: payload.igst ?? 0,
                            totalAmount: payload.totalAmount,
                            settlementMode: payload.settlementMode ?? 'REFUND',
                            createdById: payload.createdById,
                            branchId: branchId ?? null,
                            items: { create: payload.items.map((i) => ({
                                    productId: i.productId,
                                    productName: i.productName,
                                    batchId: i.batchId,
                                    batchNumber: i.batchNumber,
                                    expiryDate: new Date(i.expiryDate),
                                    returnedQty: i.returnedQty,
                                    rate: i.rate,
                                    amount: i.amount,
                                    gstPercent: i.gstPercent ?? 0,
                                })) },
                        },
                    });
                    if (payload.settlementMode === 'CREDIT' && payload.customerId) {
                        await tx.customer.update({
                            where: { id: payload.customerId },
                            data: { currentOutstanding: { decrement: payload.totalAmount } },
                        });
                    }
                });
                break;
            }
            case 'PURCHASE_RETURN': {
                const debitNoteNo = `DN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                const settlementMode = payload.settlementMode ?? 'REFUND';
                const initialStatus = settlementMode === 'ADJUST'
                    ? 'SETTLED'
                    : (payload.status ?? 'SENT');
                const isShortDelivery = /short.*delivery|short.*supply/i.test(payload.reason ?? '');
                await this.prisma.$transaction(async (tx) => {
                    if (!isShortDelivery) {
                        for (const item of payload.items ?? []) {
                            await tx.batch.update({ where: { id: item.batchId }, data: { quantity: { decrement: item.returnedQty } } });
                            await tx.product.update({ where: { id: item.productId }, data: { totalStock: { decrement: item.returnedQty } } });
                        }
                    }
                    await tx.purchaseReturn.create({
                        data: {
                            debitNoteNo,
                            grnId: payload.grnId,
                            supplierId: payload.supplierId,
                            supplierName: payload.supplierName,
                            reason: payload.reason,
                            subtotal: payload.subtotal,
                            cgst: payload.cgst ?? 0,
                            sgst: payload.sgst ?? 0,
                            igst: payload.igst ?? 0,
                            totalAmount: payload.totalAmount,
                            status: initialStatus,
                            settlementMode,
                            createdById: payload.createdById,
                            branchId: branchId ?? null,
                            items: { create: payload.items.map((i) => ({
                                    productId: i.productId,
                                    productName: i.productName,
                                    batchId: i.batchId,
                                    batchNumber: i.batchNumber,
                                    expiryDate: new Date(i.expiryDate),
                                    returnedQty: i.returnedQty,
                                    purchaseRate: i.purchaseRate,
                                    amount: i.amount,
                                    gstPercent: i.gstPercent ?? 0,
                                })) },
                        },
                    });
                    if (settlementMode === 'ADJUST') {
                        await tx.supplier.update({
                            where: { id: payload.supplierId },
                            data: { currentOutstanding: { decrement: payload.totalAmount } },
                        });
                    }
                    if (/short|excess/i.test(payload.reason ?? '') && payload.grnId) {
                        const grn = await tx.gRN.findUnique({
                            where: { id: payload.grnId },
                            select: { poId: true },
                        });
                        if (grn?.poId) {
                            const po = await tx.purchaseOrder.findUnique({
                                where: { id: grn.poId },
                                include: { items: true },
                            });
                            if (po) {
                                const allGrns = await tx.gRN.findMany({
                                    where: { poId: grn.poId },
                                    include: { items: true, purchaseReturns: { include: { items: true } } },
                                });
                                const receivedByProduct = {};
                                const debitedByProduct = {};
                                for (const g of allGrns) {
                                    for (const gi of g.items) {
                                        receivedByProduct[gi.productId] = (receivedByProduct[gi.productId] ?? 0) + gi.receivedQty + gi.freeQty;
                                    }
                                    for (const pr of g.purchaseReturns ?? []) {
                                        if (/short|excess/i.test(pr.reason ?? '')) {
                                            for (const pi of pr.items) {
                                                debitedByProduct[pi.productId] = (debitedByProduct[pi.productId] ?? 0) + pi.returnedQty;
                                            }
                                        }
                                    }
                                }
                                const allFulfilled = po.items.every((pi) => ((receivedByProduct[pi.productId] ?? 0) + (debitedByProduct[pi.productId] ?? 0)) >= pi.requiredQty);
                                await tx.purchaseOrder.update({
                                    where: { id: grn.poId },
                                    data: { status: allFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED' },
                                });
                            }
                        }
                    }
                });
                break;
            }
        }
    }
};
exports.ApprovalsService = ApprovalsService;
exports.ApprovalsService = ApprovalsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ApprovalsService);
//# sourceMappingURL=approvals.service.js.map