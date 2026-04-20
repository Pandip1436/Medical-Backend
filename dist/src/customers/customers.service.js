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
exports.CustomersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let CustomersService = class CustomersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    create(createCustomerDto) {
        return this.prisma.customer.create({ data: createCustomerDto });
    }
    findAll(query, branchId) {
        const where = {};
        if (branchId)
            where.branchId = branchId;
        if (query) {
            where.OR = [
                { name: { contains: query, mode: 'insensitive' } },
                { phone: { contains: query } },
            ];
        }
        return this.prisma.customer.findMany({ where });
    }
    async findOne(id, branchId) {
        const customer = await this.prisma.customer.findUnique({
            where: { id },
            include: {
                prescriptions: true,
                invoices: { take: 10, orderBy: { date: 'desc' } },
            },
        });
        if (!customer)
            throw new common_1.NotFoundException('Customer not found');
        if (branchId && customer.branchId && customer.branchId !== branchId) {
            throw new common_1.NotFoundException('Customer not found');
        }
        return customer;
    }
    async update(id, updateCustomerDto, branchId) {
        await this.findOne(id, branchId);
        return this.prisma.customer.update({ where: { id }, data: updateCustomerDto });
    }
    async remove(id, branchId) {
        await this.findOne(id, branchId);
        return this.prisma.customer.delete({ where: { id } });
    }
    async recordPayment(id, amount, paymentMode, referenceNumber, branchId) {
        const customer = await this.findOne(id, branchId);
        const newOutstanding = Math.max(0, Number(customer.currentOutstanding) - amount);
        await this.prisma.customer.update({
            where: { id },
            data: { currentOutstanding: newOutstanding },
        });
        return { success: true, customerId: id, amountRecorded: amount, newOutstanding };
    }
};
exports.CustomersService = CustomersService;
exports.CustomersService = CustomersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CustomersService);
//# sourceMappingURL=customers.service.js.map