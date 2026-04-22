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
let QuotationsService = class QuotationsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        const count = await this.prisma.quotation.count();
        const seq = count + 1;
        const quotationNumber = `HS/25-26/QTN/${String(seq).padStart(5, '0')}`;
        return this.prisma.quotation.create({
            data: {
                quotationNumber,
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
                    create: dto.items.map(item => ({
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
    }
    async findAll(filters) {
        const where = {};
        if (filters.q) {
            where.OR = [
                { quotationNumber: { contains: filters.q, mode: 'insensitive' } },
                { customerName: { contains: filters.q, mode: 'insensitive' } },
            ];
        }
        if (filters.fromDate || filters.toDate) {
            where.date = {};
            if (filters.fromDate)
                where.date.gte = new Date(filters.fromDate);
            if (filters.toDate) {
                const toDate = new Date(filters.toDate);
                toDate.setHours(23, 59, 59, 999);
                where.date.lte = toDate;
            }
        }
        if (filters.status)
            where.status = filters.status;
        if (filters.amountMin !== undefined || filters.amountMax !== undefined) {
            where.total = {};
            if (filters.amountMin !== undefined)
                where.total.gte = filters.amountMin;
            if (filters.amountMax !== undefined)
                where.total.lte = filters.amountMax;
        }
        return this.prisma.quotation.findMany({
            where,
            orderBy: { date: 'desc' },
            include: { items: true },
        });
    }
    async findOne(id) {
        const quotation = await this.prisma.quotation.findUnique({
            where: { id },
            include: { items: true, customer: true },
        });
        if (!quotation)
            throw new common_1.NotFoundException('Quotation not found');
        return quotation;
    }
    async update(id, data) {
        const existing = await this.prisma.quotation.findUnique({ where: { id } });
        if (!existing)
            throw new common_1.NotFoundException('Quotation not found');
        return this.prisma.quotation.update({
            where: { id },
            data,
            include: { items: true },
        });
    }
    async updateStatus(id, status) {
        const quotation = await this.prisma.quotation.findUnique({ where: { id } });
        if (!quotation)
            throw new common_1.NotFoundException('Quotation not found');
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
    async remove(id) {
        const quotation = await this.prisma.quotation.findUnique({ where: { id } });
        if (!quotation)
            throw new common_1.NotFoundException('Quotation not found');
        if (quotation.status === 'CONVERTED') {
            throw new common_1.BadRequestException('Cannot delete a converted quotation');
        }
        return this.prisma.quotation.delete({ where: { id } });
    }
    async getStats() {
        const [all, accepted, pending, rejected] = await Promise.all([
            this.prisma.quotation.aggregate({ _sum: { total: true }, _count: { _all: true } }),
            this.prisma.quotation.aggregate({
                where: { status: { in: ['ACCEPTED', 'CONVERTED'] } },
                _sum: { total: true },
                _count: { _all: true },
            }),
            this.prisma.quotation.aggregate({
                where: { status: { in: ['DRAFT', 'SENT'] } },
                _sum: { total: true },
                _count: { _all: true },
            }),
            this.prisma.quotation.count({ where: { status: 'REJECTED' } }),
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
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], QuotationsService);
//# sourceMappingURL=quotations.service.js.map