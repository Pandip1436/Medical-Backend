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
exports.SalespersonsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let SalespersonsService = class SalespersonsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(branchId) {
        return this.prisma.user.findMany({
            where: {
                role: 'SALESPERSON',
                ...(branchId ? { branchId } : {}),
            },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                isActive: true,
                commissionRate: true,
                branchId: true,
                lastLogin: true,
                createdAt: true,
            },
            orderBy: { name: 'asc' },
        });
    }
    async getStats(id, branchId) {
        const invoices = await this.prisma.invoice.findMany({
            where: {
                salespersonId: id,
                ...(branchId ? { branchId } : {}),
                status: { notIn: ['CANCELLED', 'RETURNED'] },
            },
            select: {
                grandTotal: true,
                status: true,
                date: true,
                customerName: true,
                invoiceNumber: true,
            },
        });
        const totalSales = invoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0);
        const salesperson = await this.prisma.user.findUnique({
            where: { id },
            select: { commissionRate: true, name: true },
        });
        const commissionEarned = totalSales * (Number(salesperson?.commissionRate ?? 0) / 100);
        return {
            totalInvoices: invoices.length,
            totalSales,
            commissionRate: Number(salesperson?.commissionRate ?? 0),
            commissionEarned,
        };
    }
    async getReport(branchId, from, to) {
        const salespersons = await this.prisma.user.findMany({
            where: {
                role: 'SALESPERSON',
                ...(branchId ? { branchId } : {}),
            },
            select: { id: true, name: true, isActive: true },
        });
        const dateFilter = {};
        if (from)
            dateFilter.gte = new Date(from);
        if (to)
            dateFilter.lte = new Date(to);
        const results = await Promise.all(salespersons.map(async (sp) => {
            const invoices = await this.prisma.invoice.findMany({
                where: {
                    salespersonId: sp.id,
                    ...(branchId ? { branchId } : {}),
                    status: { notIn: ['CANCELLED', 'RETURNED'] },
                    ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
                },
                select: { grandTotal: true },
            });
            const totalSales = invoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0);
            return {
                salespersonId: sp.id,
                name: sp.name,
                isActive: sp.isActive,
                invoiceCount: invoices.length,
                totalSales,
            };
        }));
        return results.sort((a, b) => b.totalSales - a.totalSales);
    }
};
exports.SalespersonsService = SalespersonsService;
exports.SalespersonsService = SalespersonsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SalespersonsService);
//# sourceMappingURL=salespersons.service.js.map