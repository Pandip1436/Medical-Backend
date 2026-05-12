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
exports.PurchaseOrdersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const document_numbering_service_1 = require("../common/services/document-numbering.service");
const PO_STATUS_TRANSITIONS = {
    DRAFT: ['SENT', 'CLOSED'],
    SENT: ['ACKNOWLEDGED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED'],
    ACKNOWLEDGED: ['PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED'],
    PARTIALLY_RECEIVED: ['FULLY_RECEIVED', 'CLOSED'],
    FULLY_RECEIVED: ['CLOSED'],
    CLOSED: [],
};
let PurchaseOrdersService = class PurchaseOrdersService {
    prisma;
    numbering;
    constructor(prisma, numbering) {
        this.prisma = prisma;
        this.numbering = numbering;
    }
    async create(createPurchaseOrderDto, userId, branchId) {
        return this.prisma.$transaction(async (tx) => {
            const supplier = await tx.supplier.findUnique({
                where: { id: createPurchaseOrderDto.supplierId },
            });
            if (!supplier)
                throw new common_1.BadRequestException('Supplier not found');
            if (branchId && supplier.branchId && supplier.branchId !== branchId) {
                throw new common_1.BadRequestException('Supplier not available in this branch');
            }
            const productIds = Array.from(new Set(createPurchaseOrderDto.items.map((i) => i.productId)));
            const foundProducts = await tx.product.findMany({
                where: { id: { in: productIds } },
                select: { id: true },
            });
            if (foundProducts.length !== productIds.length) {
                const foundSet = new Set(foundProducts.map((p) => p.id));
                const missing = productIds.filter((id) => !foundSet.has(id));
                throw new common_1.BadRequestException(`Unknown product id(s): ${missing.join(', ')}`);
            }
            const poNumber = await this.numbering.nextNumber(tx, 'PO', branchId ?? null);
            return tx.purchaseOrder.create({
                data: {
                    poNumber,
                    branchId,
                    supplierId: createPurchaseOrderDto.supplierId,
                    supplierName: createPurchaseOrderDto.supplierName,
                    totalAmount: createPurchaseOrderDto.totalAmount,
                    status: createPurchaseOrderDto.status,
                    expectedDelivery: createPurchaseOrderDto.expectedDelivery
                        ? new Date(createPurchaseOrderDto.expectedDelivery)
                        : null,
                    createdBy: userId,
                    items: {
                        create: createPurchaseOrderDto.items.map((item) => ({
                            productId: item.productId,
                            productName: item.productName,
                            requiredQty: item.requiredQty,
                            lastPurchaseRate: item.lastPurchaseRate,
                            expectedRate: item.expectedRate,
                            remarks: item.remarks,
                        })),
                    },
                },
                include: { items: true },
            });
        });
    }
    async findAll(query, branchId, page, pageSize) {
        const where = {};
        if (branchId)
            where.branchId = branchId;
        if (query) {
            where.OR = [
                { poNumber: { contains: query, mode: 'insensitive' } },
                { supplierName: { contains: query, mode: 'insensitive' } },
            ];
        }
        const include = { items: true };
        const orderBy = {
            date: 'desc',
        };
        if (!page || page < 1) {
            return this.prisma.purchaseOrder.findMany({ where, include, orderBy });
        }
        const safeSize = Math.min(Math.max(pageSize ?? 20, 1), 200);
        const [items, total] = await Promise.all([
            this.prisma.purchaseOrder.findMany({
                where,
                include,
                orderBy,
                skip: (page - 1) * safeSize,
                take: safeSize,
            }),
            this.prisma.purchaseOrder.count({ where }),
        ]);
        return { items, total, page, pageSize: safeSize };
    }
    async findOne(id, branchId) {
        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: { items: true },
        });
        if (!po)
            throw new common_1.NotFoundException('Purchase Order not found');
        if (branchId && po.branchId && po.branchId !== branchId) {
            throw new common_1.NotFoundException('Purchase Order not found');
        }
        return po;
    }
    async update(id, updatePurchaseOrderDto, branchId) {
        return this.prisma.$transaction(async (tx) => {
            const existingPo = await tx.purchaseOrder.findUnique({
                where: { id },
                include: { items: true },
            });
            if (!existingPo)
                throw new common_1.NotFoundException('Purchase order not found');
            if (branchId && existingPo.branchId && existingPo.branchId !== branchId) {
                throw new common_1.NotFoundException('Purchase order not found');
            }
            if (updatePurchaseOrderDto.status &&
                updatePurchaseOrderDto.status !== existingPo.status) {
                const allowed = PO_STATUS_TRANSITIONS[existingPo.status] ?? [];
                if (!allowed.includes(updatePurchaseOrderDto.status)) {
                    throw new common_1.BadRequestException(`Cannot transition PO from ${existingPo.status} to ${updatePurchaseOrderDto.status}`);
                }
            }
            if (updatePurchaseOrderDto.items) {
                await tx.purchaseOrderItem.deleteMany({
                    where: { purchaseOrderId: id },
                });
            }
            return tx.purchaseOrder.update({
                where: { id },
                data: {
                    supplierId: updatePurchaseOrderDto.supplierId,
                    supplierName: updatePurchaseOrderDto.supplierName,
                    totalAmount: updatePurchaseOrderDto.totalAmount,
                    status: updatePurchaseOrderDto.status,
                    expectedDelivery: updatePurchaseOrderDto.expectedDelivery
                        ? new Date(updatePurchaseOrderDto.expectedDelivery)
                        : undefined,
                    ...(updatePurchaseOrderDto.items && {
                        items: {
                            create: updatePurchaseOrderDto.items.map((item) => ({
                                productId: item.productId,
                                productName: item.productName,
                                requiredQty: item.requiredQty,
                                lastPurchaseRate: item.lastPurchaseRate,
                                expectedRate: item.expectedRate,
                                remarks: item.remarks,
                            })),
                        },
                    }),
                },
                include: { items: true },
            });
        });
    }
    async remove(id, branchId) {
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.purchaseOrder.findUnique({ where: { id } });
            if (!existing)
                throw new common_1.NotFoundException('Purchase order not found');
            if (branchId && existing.branchId && existing.branchId !== branchId) {
                throw new common_1.NotFoundException('Purchase order not found');
            }
            await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
            return tx.purchaseOrder.delete({ where: { id } });
        });
    }
};
exports.PurchaseOrdersService = PurchaseOrdersService;
exports.PurchaseOrdersService = PurchaseOrdersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        document_numbering_service_1.DocumentNumberingService])
], PurchaseOrdersService);
//# sourceMappingURL=purchase-orders.service.js.map