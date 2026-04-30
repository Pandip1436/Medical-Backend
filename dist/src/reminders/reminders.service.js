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
exports.RemindersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let RemindersService = class RemindersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(branchId) {
        return this.prisma.customerReminder.findMany({
            where: branchId ? { branchId } : undefined,
            include: {
                customer: { select: { id: true, name: true, phone: true, type: true, email: true } },
                contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
            },
            orderBy: { dayOfMonth: 'asc' },
        });
    }
    async findDueToday(branchId) {
        const today = new Date().getDate();
        return this.prisma.customerReminder.findMany({
            where: { dayOfMonth: today, ...(branchId ? { branchId } : {}) },
            include: {
                customer: { select: { id: true, name: true, phone: true, type: true, email: true } },
                contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
            },
        });
    }
    async create(dto) {
        return this.prisma.customerReminder.create({
            data: {
                customerId: dto.customerId,
                dayOfMonth: dto.dayOfMonth,
                title: dto.title,
                notes: dto.notes,
                branchId: dto.branchId,
            },
            include: {
                customer: { select: { id: true, name: true, phone: true, type: true, email: true } },
                contacts: true,
            },
        });
    }
    async update(id, dto) {
        return this.prisma.customerReminder.update({
            where: { id },
            data: dto,
            include: {
                customer: { select: { id: true, name: true, phone: true, type: true, email: true } },
                contacts: { orderBy: { contactedAt: 'desc' }, take: 1 },
            },
        });
    }
    async remove(id) {
        return this.prisma.customerReminder.delete({ where: { id } });
    }
    async addContactLog(reminderId, dto) {
        return this.prisma.reminderContact.create({
            data: {
                reminderId,
                status: dto.status,
                notes: dto.notes,
            },
        });
    }
    async getContactLogs(reminderId) {
        return this.prisma.reminderContact.findMany({
            where: { reminderId },
            orderBy: { contactedAt: 'desc' },
        });
    }
};
exports.RemindersService = RemindersService;
exports.RemindersService = RemindersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RemindersService);
//# sourceMappingURL=reminders.service.js.map