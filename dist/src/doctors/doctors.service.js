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
exports.DoctorsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let DoctorsService = class DoctorsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        return this.prisma.doctor.create({ data: dto });
    }
    async findAll(branchId, includeInactive = false) {
        const where = includeInactive ? {} : { isActive: true };
        if (branchId)
            where.branchId = branchId;
        return this.prisma.doctor.findMany({ where, orderBy: { name: 'asc' } });
    }
    async findOne(id, branchId) {
        const doctor = await this.prisma.doctor.findUnique({ where: { id } });
        if (!doctor)
            throw new common_1.NotFoundException(`Doctor ${id} not found`);
        if (branchId && doctor.branchId && doctor.branchId !== branchId) {
            throw new common_1.NotFoundException(`Doctor ${id} not found`);
        }
        return doctor;
    }
    async update(id, dto, branchId) {
        await this.findOne(id, branchId);
        return this.prisma.doctor.update({ where: { id }, data: dto });
    }
    async remove(id, branchId) {
        await this.findOne(id, branchId);
        return this.prisma.doctor.update({ where: { id }, data: { isActive: false } });
    }
};
exports.DoctorsService = DoctorsService;
exports.DoctorsService = DoctorsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DoctorsService);
//# sourceMappingURL=doctors.service.js.map