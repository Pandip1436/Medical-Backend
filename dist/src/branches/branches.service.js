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
exports.BranchesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let BranchesService = class BranchesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        const existing = await this.prisma.branch.findUnique({ where: { code: dto.code } });
        if (existing)
            throw new common_1.ConflictException('Branch code already exists');
        return this.prisma.branch.create({ data: dto });
    }
    findAll() {
        return this.prisma.branch.findMany({
            orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        });
    }
    async findOne(id) {
        const branch = await this.prisma.branch.findUnique({ where: { id } });
        if (!branch)
            throw new common_1.NotFoundException('Branch not found');
        return branch;
    }
    async update(id, dto) {
        await this.findOne(id);
        if (dto.isDefault) {
            await this.prisma.branch.updateMany({
                where: { isDefault: true },
                data: { isDefault: false },
            });
        }
        return this.prisma.branch.update({ where: { id }, data: dto });
    }
    async remove(id) {
        await this.findOne(id);
        return this.prisma.branch.delete({ where: { id } });
    }
    async stats(id) {
        const [invoiceCount, invoiceTotal, expenseTotal] = await Promise.all([
            this.prisma.invoice.count({ where: { branchId: id, type: 'INVOICE' } }),
            this.prisma.invoice.aggregate({
                where: { branchId: id, type: 'INVOICE', status: { not: 'CANCELLED' } },
                _sum: { grandTotal: true },
            }),
            this.prisma.expense.aggregate({
                where: { branchId: id },
                _sum: { amount: true },
            }),
        ]);
        return {
            invoiceCount,
            invoiceTotal: Number(invoiceTotal._sum.grandTotal ?? 0),
            expenseTotal: Number(expenseTotal._sum.amount ?? 0),
        };
    }
};
exports.BranchesService = BranchesService;
exports.BranchesService = BranchesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], BranchesService);
//# sourceMappingURL=branches.service.js.map