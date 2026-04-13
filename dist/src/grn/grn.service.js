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
let GrnService = class GrnService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createGrnDto) {
        return this.prisma.$transaction(async (tx) => {
            const grnNumber = `GRN-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            for (const item of createGrnDto.items) {
                const addedStock = item.receivedQty + item.freeQty - item.damageQty;
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
                        }
                    });
                    await tx.product.update({
                        where: { id: item.productId },
                        data: {
                            totalStock: { increment: addedStock },
                            purchaseRate: item.purchaseRate,
                            mrp: item.mrp
                        }
                    });
                }
            }
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
                    items: {
                        create: createGrnDto.items.map(item => ({
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
                            damageQty: item.damageQty
                        }))
                    }
                },
                include: { items: true }
            });
            if (createGrnDto.poId) {
                await tx.purchaseOrder.update({
                    where: { id: createGrnDto.poId },
                    data: { status: 'FULLY_RECEIVED' }
                });
            }
            return grn;
        });
    }
    findAll(query) {
        if (query) {
            return this.prisma.gRN.findMany({
                where: {
                    OR: [
                        { grnNumber: { contains: query, mode: 'insensitive' } },
                        { supplierName: { contains: query, mode: 'insensitive' } },
                        { supplierInvoiceNo: { contains: query, mode: 'insensitive' } },
                    ],
                },
                orderBy: { date: 'desc' },
            });
        }
        return this.prisma.gRN.findMany({ orderBy: { date: 'desc' } });
    }
    async findOne(id) {
        const grn = await this.prisma.gRN.findUnique({
            where: { id },
            include: { items: true }
        });
        if (!grn)
            throw new common_1.NotFoundException('GRN not found');
        return grn;
    }
};
exports.GrnService = GrnService;
exports.GrnService = GrnService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GrnService);
//# sourceMappingURL=grn.service.js.map