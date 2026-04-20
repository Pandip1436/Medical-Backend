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
let PurchaseReturnsService = class PurchaseReturnsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto, userId, userBranchId) {
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
            for (const item of dto.items) {
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
            return purchaseReturn;
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
};
exports.PurchaseReturnsService = PurchaseReturnsService;
exports.PurchaseReturnsService = PurchaseReturnsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PurchaseReturnsService);
//# sourceMappingURL=purchase-returns.service.js.map