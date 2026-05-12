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
exports.QuotationsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const document_numbering_service_1 = require("../common/services/document-numbering.service");
let QuotationsService = class QuotationsService {
    prisma;
    numbering;
    constructor(prisma, numbering) {
        this.prisma = prisma;
        this.numbering = numbering;
    }
    async create(dto, branchId) {
        return this.prisma.$transaction(async (tx) => {
            const quotationNumber = await this.numbering.nextNumber(tx, 'QTN', branchId ?? null);
            return tx.quotation.create({
                data: {
                    quotationNumber,
                    branchId,
                    customerId: dto.customerId || null,
                    customerName: dto.customerName,
                    subtotal: dto.subtotal,
                    cgst: dto.cgst,
                    sgst: dto.sgst,
                    total: dto.total,
                    validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
                    notes: dto.notes,
                    status: 'DRAFT',
                    items: {
                        create: dto.items.map((item) => ({
                            productId: item.productId || null,
                            productName: item.productName,
                            batchId: item.batchId || null,
                            batchNumber: item.batchNumber || null,
                            quantity: item.quantity,
                            mrp: item.mrp || 0,
                            rate: item.rate,
                            discountPercent: item.discountPercent || 0,
                            gstPercent: item.gstPercent || 0,
                            amount: item.amount,
                        })),
                    },
                },
                include: { items: true },
            });
        });
    }
    async findAll(filters) {
        const where = {};
        if (filters.branchId)
            where.branchId = filters.branchId;
        if (filters.q) {
            where.OR = [
                { quotationNumber: { contains: filters.q, mode: 'insensitive' } },
                { customerName: { contains: filters.q, mode: 'insensitive' } },
            ];
        }
        if (filters.fromDate || filters.toDate) {
            const dateFilter = {};
            if (filters.fromDate)
                dateFilter.gte = new Date(filters.fromDate);
            if (filters.toDate) {
                const toDate = new Date(filters.toDate);
                toDate.setHours(23, 59, 59, 999);
                dateFilter.lte = toDate;
            }
            where.date = dateFilter;
        }
        if (filters.status)
            where.status = filters.status;
        if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
            const totalFilter = {};
            if (filters.amountMin !== undefined)
                totalFilter.gte = filters.amountMin;
            if (filters.amountMax !== undefined)
                totalFilter.lte = filters.amountMax;
            where.total = totalFilter;
        }
        return this.prisma.quotation.findMany({
            where,
            orderBy: { date: 'desc' },
            include: { items: true },
        });
    }
    async findOne(id, branchId) {
        const quotation = await this.prisma.quotation.findUnique({
            where: { id },
            include: { items: true, customer: true },
        });
        if (!quotation)
            throw new common_1.NotFoundException('Quotation not found');
        if (branchId && quotation.branchId && quotation.branchId !== branchId) {
            throw new common_1.NotFoundException('Quotation not found');
        }
        return quotation;
    }
    async update(id, data, branchId) {
        const existing = await this.prisma.quotation.findUnique({ where: { id } });
        if (!existing)
            throw new common_1.NotFoundException('Quotation not found');
        if (branchId && existing.branchId && existing.branchId !== branchId) {
            throw new common_1.NotFoundException('Quotation not found');
        }
        return this.prisma.quotation.update({
            where: { id },
            data,
            include: { items: true },
        });
    }
    async updateStatus(id, status, branchId) {
        const quotation = await this.prisma.quotation.findUnique({ where: { id } });
        if (!quotation)
            throw new common_1.NotFoundException('Quotation not found');
        if (branchId && quotation.branchId && quotation.branchId !== branchId) {
            throw new common_1.NotFoundException('Quotation not found');
        }
        const validTransitions = {
            DRAFT: ['SENT', 'ACCEPTED', 'REJECTED'],
            SENT: ['ACCEPTED', 'REJECTED'],
            ACCEPTED: ['CONVERTED'],
            REJECTED: ['DRAFT'],
            CONVERTED: [],
        };
        const allowed = validTransitions[quotation.status] || [];
        if (!allowed.includes(status)) {
            throw new common_1.BadRequestException(`Cannot transition from ${quotation.status} to ${status}`);
        }
        return this.prisma.quotation.update({
            where: { id },
            data: { status: status },
            include: { items: true },
        });
    }
    async remove(id, branchId) {
        const quotation = await this.prisma.quotation.findUnique({ where: { id } });
        if (!quotation)
            throw new common_1.NotFoundException('Quotation not found');
        if (branchId && quotation.branchId && quotation.branchId !== branchId) {
            throw new common_1.NotFoundException('Quotation not found');
        }
        if (quotation.status === 'CONVERTED') {
            throw new common_1.BadRequestException('Cannot delete a converted quotation');
        }
        return this.prisma.quotation.delete({ where: { id } });
    }
    async getStats(branchId) {
        const branchWhere = branchId ? { branchId } : {};
        const [all, accepted, pending, rejected] = await Promise.all([
            this.prisma.quotation.aggregate({
                where: branchWhere,
                _sum: { total: true },
                _count: { _all: true },
            }),
            this.prisma.quotation.aggregate({
                where: { ...branchWhere, status: { in: ['ACCEPTED', 'CONVERTED'] } },
                _sum: { total: true },
                _count: { _all: true },
            }),
            this.prisma.quotation.aggregate({
                where: { ...branchWhere, status: { in: ['DRAFT', 'SENT'] } },
                _sum: { total: true },
                _count: { _all: true },
            }),
            this.prisma.quotation.count({
                where: { ...branchWhere, status: 'REJECTED' },
            }),
        ]);
        return {
            total: Number(all._sum?.total || 0),
            totalCount: all._count._all,
            acceptedTotal: Number(accepted._sum?.total || 0),
            acceptedCount: accepted._count._all,
            pendingTotal: Number(pending._sum?.total || 0),
            pendingCount: pending._count._all,
            rejectedCount: rejected,
        };
    }
};
exports.QuotationsService = QuotationsService;
exports.QuotationsService = QuotationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        document_numbering_service_1.DocumentNumberingService])
], QuotationsService);
//# sourceMappingURL=quotations.service.js.map