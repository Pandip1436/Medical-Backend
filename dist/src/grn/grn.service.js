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
exports.GrnService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const document_numbering_service_1 = require("../common/services/document-numbering.service");
let GrnService = class GrnService {
    prisma;
    numbering;
    constructor(prisma, numbering) {
        this.prisma = prisma;
        this.numbering = numbering;
    }
    async create(createGrnDto, branchId) {
        const effectiveBranchId = branchId ?? createGrnDto.branchId;
        return this.prisma.$transaction(async (tx) => {
            const grnNumber = await this.numbering.nextNumber(tx, 'GRN', effectiveBranchId ?? null);
            if (createGrnDto.poId) {
                const po = await tx.purchaseOrder.findUnique({
                    where: { id: createGrnDto.poId },
                    include: { items: true },
                });
                if (!po)
                    throw new common_1.BadRequestException('Linked Purchase Order not found');
                const priorGrns = await tx.gRN.findMany({
                    where: { poId: createGrnDto.poId },
                    include: { items: true },
                });
                const priorByProduct = {};
                for (const g of priorGrns) {
                    for (const gi of g.items) {
                        priorByProduct[gi.productId] =
                            (priorByProduct[gi.productId] ?? 0) + gi.receivedQty + gi.freeQty;
                    }
                }
                const requiredByProduct = {};
                for (const pi of po.items)
                    requiredByProduct[pi.productId] = pi.requiredQty;
                for (const item of createGrnDto.items) {
                    const required = requiredByProduct[item.productId];
                    if (required === undefined)
                        continue;
                    const alreadyReceived = priorByProduct[item.productId] ?? 0;
                    const remaining = Math.max(0, required - alreadyReceived);
                    const incoming = item.receivedQty + item.freeQty;
                    if (incoming > remaining) {
                        throw new common_1.BadRequestException(`Cannot receive ${incoming} of ${item.productName}: only ${remaining} remaining on PO (ordered ${required}, already received ${alreadyReceived})`);
                    }
                }
            }
            for (const item of createGrnDto.items) {
                const addedStock = item.receivedQty + item.freeQty;
                if (addedStock > 0) {
                    await tx.batch.create({
                        data: {
                            productId: item.productId,
                            batchNumber: item.batchNumber,
                            mfgDate: new Date(item.mfgDate),
                            expiryDate: new Date(item.expiryDate),
                            quantity: addedStock,
                            mrp: item.mrp,
                            purchaseRate: item.purchaseRate,
                            supplierId: createGrnDto.supplierId,
                        },
                    });
                    await tx.product.update({
                        where: { id: item.productId },
                        data: {
                            totalStock: { increment: addedStock },
                            purchaseRate: item.purchaseRate,
                            mrp: item.mrp,
                        },
                    });
                }
            }
            const isReplacement = createGrnDto.isReplacement === true;
            const grn = await tx.gRN.create({
                data: {
                    grnNumber,
                    poId: createGrnDto.poId,
                    supplierId: createGrnDto.supplierId,
                    supplierName: createGrnDto.supplierName,
                    supplierInvoiceNo: createGrnDto.supplierInvoiceNo,
                    supplierInvoiceDate: new Date(createGrnDto.supplierInvoiceDate),
                    supplierInvoiceAmount: createGrnDto.supplierInvoiceAmount,
                    totalAmount: createGrnDto.totalAmount,
                    status: createGrnDto.status,
                    branchId: effectiveBranchId,
                    isReplacement,
                    items: {
                        create: createGrnDto.items.map((item) => ({
                            productId: item.productId,
                            productName: item.productName,
                            orderedQty: item.orderedQty,
                            receivedQty: item.receivedQty,
                            freeQty: item.freeQty,
                            batchNumber: item.batchNumber,
                            mfgDate: new Date(item.mfgDate),
                            expiryDate: new Date(item.expiryDate),
                            purchaseRate: item.purchaseRate,
                            mrp: item.mrp,
                            damageQty: item.damageQty,
                        })),
                    },
                },
                include: { items: true },
            });
            if (!isReplacement && createGrnDto.supplierInvoiceAmount > 0) {
                await tx.supplier.update({
                    where: { id: createGrnDto.supplierId },
                    data: {
                        currentOutstanding: {
                            increment: createGrnDto.supplierInvoiceAmount,
                        },
                    },
                });
            }
            if (createGrnDto.poId) {
                const po = await tx.purchaseOrder.findUnique({
                    where: { id: createGrnDto.poId },
                    include: { items: true },
                });
                if (po) {
                    const allGrns = await tx.gRN.findMany({
                        where: { poId: createGrnDto.poId },
                        include: { items: true },
                    });
                    const receivedByProduct = {};
                    for (const g of allGrns) {
                        for (const gi of g.items) {
                            receivedByProduct[gi.productId] =
                                (receivedByProduct[gi.productId] ?? 0) +
                                    gi.receivedQty +
                                    gi.freeQty;
                        }
                    }
                    for (const pi of po.items) {
                        const totalReceived = receivedByProduct[pi.productId] ?? 0;
                        if (totalReceived !== pi.receivedQty) {
                            await tx.purchaseOrderItem.update({
                                where: { id: pi.id },
                                data: { receivedQty: totalReceived },
                            });
                        }
                    }
                    const allFulfilled = po.items.every((pi) => (receivedByProduct[pi.productId] ?? 0) >= pi.requiredQty);
                    await tx.purchaseOrder.update({
                        where: { id: createGrnDto.poId },
                        data: {
                            status: allFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED',
                        },
                    });
                }
            }
            return grn;
        });
    }
    async findAll(query, branchId, page, pageSize) {
        const where = {};
        if (branchId)
            where.branchId = branchId;
        if (query) {
            where.OR = [
                { grnNumber: { contains: query, mode: 'insensitive' } },
                { supplierName: { contains: query, mode: 'insensitive' } },
                { supplierInvoiceNo: { contains: query, mode: 'insensitive' } },
            ];
        }
        const include = {
            items: true,
            purchaseReturns: { include: { items: true } },
        };
        const orderBy = {
            date: 'desc',
        };
        if (!page || page < 1) {
            return this.prisma.gRN.findMany({ where, include, orderBy });
        }
        const safeSize = Math.min(Math.max(pageSize ?? 20, 1), 200);
        const [items, total] = await Promise.all([
            this.prisma.gRN.findMany({
                where,
                include,
                orderBy,
                skip: (page - 1) * safeSize,
                take: safeSize,
            }),
            this.prisma.gRN.count({ where }),
        ]);
        return { items, total, page, pageSize: safeSize };
    }
    async reverseShortDeliveryStockDeduction() {
        const allReturns = await this.prisma.purchaseReturn.findMany({
            include: { items: true },
        });
        const shortReturns = allReturns.filter((pr) => /short.*delivery|short.*supply/i.test(pr.reason ?? '') &&
            !pr.stockReversedAt);
        let batchesFixed = 0;
        let productsFixed = 0;
        const fixed = [];
        const skipped = allReturns.filter((pr) => /short.*delivery|short.*supply/i.test(pr.reason ?? '') &&
            pr.stockReversedAt).length;
        for (const pr of shortReturns) {
            for (const item of pr.items) {
                const batch = await this.prisma.batch.findUnique({
                    where: { id: item.batchId },
                });
                if (batch) {
                    await this.prisma.batch.update({
                        where: { id: item.batchId },
                        data: { quantity: { increment: item.returnedQty } },
                    });
                    batchesFixed++;
                }
                await this.prisma.product
                    .update({
                    where: { id: item.productId },
                    data: { totalStock: { increment: item.returnedQty } },
                })
                    .catch(() => { });
                productsFixed++;
            }
            await this.prisma.purchaseReturn.update({
                where: { id: pr.id },
                data: { stockReversedAt: new Date() },
            });
            fixed.push({
                debitNoteNo: pr.debitNoteNo,
                reason: pr.reason,
                items: pr.items.length,
            });
        }
        const skipNote = skipped > 0 ? ` Skipped ${skipped} already-reversed debit note(s).` : '';
        return {
            message: `Reversed stock deduction for ${shortReturns.length} short-delivery debit note(s). ` +
                `${batchesFixed} batch updates, ${productsFixed} product stock updates.${skipNote}`,
            fixed,
            skipped,
        };
    }
    async backfillPoStatusWithDebitNotes() {
        const pos = await this.prisma.purchaseOrder.findMany({
            include: { items: true },
        });
        let updated = 0;
        for (const po of pos) {
            const allGrns = await this.prisma.gRN.findMany({
                where: { poId: po.id },
                include: { items: true, purchaseReturns: { include: { items: true } } },
            });
            if (allGrns.length === 0)
                continue;
            const receivedByProduct = {};
            const debitedByProduct = {};
            for (const g of allGrns) {
                for (const gi of g.items) {
                    receivedByProduct[gi.productId] =
                        (receivedByProduct[gi.productId] ?? 0) +
                            gi.receivedQty +
                            gi.freeQty;
                }
                for (const pr of g.purchaseReturns ?? []) {
                    if (/short|excess/i.test(pr.reason ?? '')) {
                        for (const pi of pr.items) {
                            debitedByProduct[pi.productId] =
                                (debitedByProduct[pi.productId] ?? 0) + pi.returnedQty;
                        }
                    }
                }
            }
            const allFulfilled = po.items.every((pi) => (receivedByProduct[pi.productId] ?? 0) +
                (debitedByProduct[pi.productId] ?? 0) >=
                pi.requiredQty);
            const expected = allFulfilled ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED';
            if (po.status !== expected &&
                po.status !== 'CLOSED' &&
                po.status !== 'DRAFT') {
                await this.prisma.purchaseOrder.update({
                    where: { id: po.id },
                    data: { status: expected },
                });
                updated++;
            }
        }
        return {
            message: `PO status backfill (with debit notes) complete. ${updated} POs updated.`,
        };
    }
    async backfillSupplierOutstanding() {
        const suppliers = await this.prisma.supplier.findMany();
        let updated = 0;
        for (const s of suppliers) {
            const grns = await this.prisma.gRN.findMany({
                where: { supplierId: s.id },
            });
            const grnSum = grns.reduce((acc, g) => acc + (g.isReplacement ? 0 : Number(g.supplierInvoiceAmount)), 0);
            const adjustReturns = await this.prisma.purchaseReturn.findMany({
                where: { supplierId: s.id, settlementMode: 'ADJUST' },
            });
            const adjustSum = adjustReturns.reduce((acc, r) => acc + Number(r.totalAmount), 0);
            const expected = Math.max(0, grnSum - adjustSum);
            if (Number(s.currentOutstanding) !== expected) {
                await this.prisma.supplier.update({
                    where: { id: s.id },
                    data: { currentOutstanding: expected },
                });
                updated++;
            }
        }
        return {
            message: `Supplier outstanding backfill complete. ${updated} suppliers updated.`,
        };
    }
    async backfillGrnOrderedQty() {
        const pos = await this.prisma.purchaseOrder.findMany({
            include: { items: true },
        });
        let updated = 0;
        for (const po of pos) {
            const grns = await this.prisma.gRN.findMany({
                where: { poId: po.id },
                include: { items: true },
                orderBy: { date: 'asc' },
            });
            if (grns.length === 0)
                continue;
            const cumulativeReceived = {};
            const requiredByProduct = {};
            for (const pi of po.items) {
                requiredByProduct[pi.productId] = pi.requiredQty;
            }
            for (const grn of grns) {
                for (const gi of grn.items) {
                    const required = requiredByProduct[gi.productId] ?? gi.orderedQty;
                    const alreadyReceived = cumulativeReceived[gi.productId] ?? 0;
                    const expectedThisDelivery = Math.max(0, required - alreadyReceived);
                    if (expectedThisDelivery !== gi.orderedQty) {
                        await this.prisma.gRNItem.update({
                            where: { id: gi.id },
                            data: { orderedQty: expectedThisDelivery },
                        });
                        updated++;
                    }
                    cumulativeReceived[gi.productId] =
                        alreadyReceived + gi.receivedQty + gi.freeQty;
                }
            }
        }
        return { message: `Backfill complete. ${updated} GRN items updated.` };
    }
    async backfillPoReceivedQty() {
        const pos = await this.prisma.purchaseOrder.findMany({
            include: { items: true },
        });
        let updated = 0;
        for (const po of pos) {
            const allGrns = await this.prisma.gRN.findMany({
                where: { poId: po.id },
                include: { items: true },
            });
            if (allGrns.length === 0)
                continue;
            const receivedByProduct = {};
            for (const g of allGrns) {
                for (const gi of g.items) {
                    receivedByProduct[gi.productId] =
                        (receivedByProduct[gi.productId] ?? 0) +
                            gi.receivedQty +
                            gi.freeQty;
                }
            }
            for (const pi of po.items) {
                const totalReceived = receivedByProduct[pi.productId] ?? 0;
                if (totalReceived !== pi.receivedQty) {
                    await this.prisma.purchaseOrderItem.update({
                        where: { id: pi.id },
                        data: { receivedQty: totalReceived },
                    });
                    updated++;
                }
            }
            const allFulfilled = po.items.every((pi) => (receivedByProduct[pi.productId] ?? 0) >= pi.requiredQty);
            const expectedStatus = allFulfilled
                ? 'FULLY_RECEIVED'
                : 'PARTIALLY_RECEIVED';
            if (po.status !== expectedStatus &&
                po.status !== 'CLOSED' &&
                po.status !== 'DRAFT') {
                await this.prisma.purchaseOrder.update({
                    where: { id: po.id },
                    data: { status: expectedStatus },
                });
            }
        }
        return { message: `Backfill complete. ${updated} PO items updated.` };
    }
    async findOne(id, branchId) {
        const grn = await this.prisma.gRN.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!grn)
            throw new common_1.NotFoundException('GRN not found');
        if (branchId && grn.branchId && grn.branchId !== branchId) {
            throw new common_1.NotFoundException('GRN not found');
        }
        return grn;
    }
};
exports.GrnService = GrnService;
exports.GrnService = GrnService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        document_numbering_service_1.DocumentNumberingService])
], GrnService);
//# sourceMappingURL=grn.service.js.map