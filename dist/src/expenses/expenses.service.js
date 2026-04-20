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
exports.ExpensesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ExpensesService = class ExpensesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto, branchId) {
        return this.prisma.expense.create({
            data: {
                date: new Date(dto.date),
                category: dto.category,
                description: dto.description,
                amount: dto.amount,
                paymentMode: dto.paymentMode,
                receiptImage: dto.receiptImage,
                branchId: branchId ?? dto.branchId,
            },
        });
    }
    async findAll(category, from, to, branchId) {
        const where = {};
        if (category)
            where.category = category;
        if (branchId)
            where.branchId = branchId;
        if (from || to) {
            where.date = {};
            if (from)
                where.date.gte = new Date(from);
            if (to)
                where.date.lte = new Date(to);
        }
        const rows = await this.prisma.expense.findMany({
            where,
            orderBy: { date: 'desc' },
            take: 200,
        });
        return rows.map((e) => ({ ...e, amount: Number(e.amount) }));
    }
    async findOne(id, branchId) {
        const expense = await this.prisma.expense.findUnique({ where: { id } });
        if (!expense)
            throw new common_1.NotFoundException('Expense not found');
        if (branchId && expense.branchId && expense.branchId !== branchId) {
            throw new common_1.NotFoundException('Expense not found');
        }
        return { ...expense, amount: Number(expense.amount) };
    }
    async update(id, dto, branchId) {
        await this.findOne(id, branchId);
        const updated = await this.prisma.expense.update({
            where: { id },
            data: {
                ...(dto.date && { date: new Date(dto.date) }),
                ...(dto.category && { category: dto.category }),
                ...(dto.description && { description: dto.description }),
                ...(dto.amount !== undefined && { amount: dto.amount }),
                ...(dto.paymentMode && { paymentMode: dto.paymentMode }),
                ...(dto.receiptImage !== undefined && { receiptImage: dto.receiptImage }),
            },
        });
        return { ...updated, amount: Number(updated.amount) };
    }
    async remove(id, branchId) {
        await this.findOne(id, branchId);
        return this.prisma.expense.delete({ where: { id } });
    }
};
exports.ExpensesService = ExpensesService;
exports.ExpensesService = ExpensesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ExpensesService);
//# sourceMappingURL=expenses.service.js.map