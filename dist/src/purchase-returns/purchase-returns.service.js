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
exports.PurchaseReturnsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const approvals_service_1 = require("../approvals/approvals.service");
let PurchaseReturnsService = class PurchaseReturnsService {
    prisma;
    approvalsService;
    constructor(prisma, approvalsService) {
        this.prisma = prisma;
        this.approvalsService = approvalsService;
    }
    async create(dto, userId, userBranchId, userRole) {
        if (userRole === 'PHARMACIST' || userRole === 'INVENTORY_MANAGER') {
            const req = await this.approvalsService.createRequest({
                type: 'PURCHASE_RETURN',
                payload: { ...dto, createdById: userId },
                requestedById: userId,
                branchId: userBranchId,
            });
            return { approvalRequested: true, approvalRequestId: req.id };
        }
        return this.prisma.$transaction(async (tx) => {
            let branchId = userBranchId ?? null;
            if (dto.grnId) {
                const grn = await tx.gRN.findUnique({ where: { id: dto.grnId }, select: { branchId: true } });
                if (grn) {
                    if (userBranchId && grn.branchId && grn.branchId !== userBranchId) {
                        throw new common_1.NotFoundException('GRN not found');
                    }
                    branchId = grn.branchId ?? userBranchId ?? null;
                }
            }
            const isShortDelivery = /short.*delivery|short.*supply/i.test(dto.reason ?? '');
            for (const item of dto.items) {
                if (isShortDelivery)
                    continue;
                const batch = await tx.batch.findUnique({ where: { id: item.batchId } });
                if (!batch) {
                    throw new common_1.NotFoundException(`Batch ${item.batchNumber} for ${item.productName} not found`);
                }
                if (batch.quantity < item.returnedQty) {
                    throw new common_1.BadRequestException(`Insufficient stock to return for ${item.productName} batch ${item.batchNumber}. Available: ${batch.quantity}`);
                }
                await tx.batch.update({
                    where: { id: batch.id },
                    data: { quantity: batch.quantity - item.returnedQty },
                });
                await tx.product.update({
                    where: { id: item.productId },
                    data: { totalStock: { decrement: item.returnedQty } },
                });
            }
            const debitNoteNo = `DN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const settlementMode = dto.settlementMode ?? 'REFUND';
            const purchaseReturn = await tx.purchaseReturn.create({
                data: {
                    debitNoteNo,
                    branchId,
                    grnId: dto.grnId,
                    supplierId: dto.supplierId,
                    supplierName: dto.supplierName,
                    reason: dto.reason,
                    subtotal: dto.subtotal,
                    cgst: dto.cgst ?? 0,
                    sgst: dto.sgst ?? 0,
                    igst: dto.igst ?? 0,
                    totalAmount: dto.totalAmount,
                    status: dto.status ?? 'DRAFT',
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
                            purchaseRate: it.purchaseRate,
                            gstPercent: it.gstPercent,
                            amount: it.amount,
                        })),
                    },
                },
                include: { items: true },
            });
            if (settlementMode === 'ADJUST') {
                await tx.supplier.update({
                    where: { id: dto.supplierId },
                    data: { currentOutstanding: { decrement: dto.totalAmount } },
                });
                await tx.purchaseReturn.update({
                    where: { id: purchaseReturn.id },
                    data: { status: 'SETTLED' },
                });
            }
            if (/short|excess/i.test(dto.reason ?? '') && dto.grnId) {
                const grn = await tx.gRN.findUnique({
                    where: { id: dto.grnId },
                    select: { poId: true },
                });
                if (grn?.poId) {
                    await this.recomputePoStatus(tx, grn.poId);
                }
            }
            return purchaseReturn;
        });
    }
    async recomputePoStatus(tx, poId) {
        const po = await tx.purchaseOrder.findUnique({
            where: { id: poId },
            include: { items: true },
        });
        if (!po)
            return;
        const allGrns = await tx.gRN.findMany({
            where: { poId },
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
            where: { id: poId },
            data: { status: allFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED' },
        });
    }
    findAll(query, branchId) {
        const where = {};
        if (branchId)
            where.branchId = branchId;
        if (query) {
            where.OR = [
                { debitNoteNo: { contains: query, mode: 'insensitive' } },
                { supplierName: { contains: query, mode: 'insensitive' } },
            ];
        }
        return this.prisma.purchaseReturn.findMany({
            where,
            orderBy: { date: 'desc' },
            take: 50,
            include: { items: true, grn: true }
        });
    }
    async findOne(id, branchId) {
        const pr = await this.prisma.purchaseReturn.findUnique({
            where: { id },
            include: { items: true, supplier: true, grn: true },
        });
        if (!pr)
            throw new common_1.NotFoundException('Purchase return not found');
        if (branchId && pr.branchId && pr.branchId !== branchId) {
            throw new common_1.NotFoundException('Purchase return not found');
        }
        return pr;
    }
    async updateStatus(id, status, branchId) {
        const pr = await this.prisma.purchaseReturn.findUnique({ where: { id } });
        if (!pr)
            throw new common_1.NotFoundException('Purchase return not found');
        if (branchId && pr.branchId && pr.branchId !== branchId) {
            throw new common_1.NotFoundException('Purchase return not found');
        }
        return this.prisma.purchaseReturn.update({
            where: { id },
            data: { status },
        });
    }
    async linkReplacementGrn(id, replacementGrnId, branchId) {
        const pr = await this.prisma.purchaseReturn.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!pr)
            throw new common_1.NotFoundException('Purchase return not found');
        if (branchId && pr.branchId && pr.branchId !== branchId) {
            throw new common_1.NotFoundException('Purchase return not found');
        }
        if (pr.settlementMode !== 'REPLACEMENT') {
            throw new common_1.BadRequestException('This debit note does not use Replacement settlement');
        }
        return this.prisma.purchaseReturn.update({
            where: { id },
            data: {
                replacementGrnId,
                status: 'SETTLED',
            },
            include: { items: true },
        });
    }
};
exports.PurchaseReturnsService = PurchaseReturnsService;
exports.PurchaseReturnsService = PurchaseReturnsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        approvals_service_1.ApprovalsService])
], PurchaseReturnsService);
//# sourceMappingURL=purchase-returns.service.js.map