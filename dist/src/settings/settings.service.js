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
exports.SettingsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let SettingsService = class SettingsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getTargetBranchId(branchId) {
        if (branchId)
            return branchId;
        const defaultBranch = await this.prisma.branch.findFirst({
            where: { isDefault: true },
        });
        if (defaultBranch)
            return defaultBranch.id;
        const firstBranch = await this.prisma.branch.findFirst();
        return firstBranch?.id;
    }
    async getBusinessProfile(branchId) {
        const id = await this.getTargetBranchId(branchId);
        if (!id)
            return null;
        return this.prisma.branch.findUnique({
            where: { id },
        });
    }
    async updateBusinessProfile(branchId, data) {
        const id = await this.getTargetBranchId(branchId);
        if (!id)
            throw new Error('No branch found to update');
        return this.prisma.branch.update({
            where: { id },
            data: {
                name: data.companyName || data.name,
                address: data.address,
                phone: data.phone,
                email: data.email,
                gstin: data.gstin,
                drugLicense: data.drugLicense,
            },
        });
    }
    async getSetting(key) {
        const setting = await this.prisma.globalSetting.findUnique({
            where: { key },
        });
        return setting?.value || {};
    }
    async updateSetting(key, value) {
        return this.prisma.globalSetting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });
    }
    async getDiscountRules(branchId) {
        const id = await this.getTargetBranchId(branchId);
        return this.prisma.discountRule.findMany({
            where: {
                OR: [
                    ...(id ? [{ branchId: id }] : []),
                    { branchId: null },
                ],
            },
        });
    }
    async createDiscountRule(branchId, data) {
        const id = await this.getTargetBranchId(branchId);
        return this.prisma.discountRule.create({
            data: {
                name: data.name,
                type: data.type,
                value: data.value,
                applicableTo: data.applicableTo,
                validFrom: data.validFrom ? new Date(data.validFrom) : null,
                validTo: data.validTo ? new Date(data.validTo) : null,
                isActive: data.isActive ?? true,
                branchId: id,
            },
        });
    }
    async updateDiscountRule(id, data) {
        return this.prisma.discountRule.update({
            where: { id },
            data: {
                name: data.name,
                type: data.type,
                value: data.value,
                applicableTo: data.applicableTo,
                validFrom: data.validFrom ? new Date(data.validFrom) : null,
                validTo: data.validTo ? new Date(data.validTo) : null,
                isActive: data.isActive,
            },
        });
    }
    async deleteDiscountRule(id) {
        return this.prisma.discountRule.delete({
            where: { id },
        });
    }
};
exports.SettingsService = SettingsService;
exports.SettingsService = SettingsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SettingsService);
//# sourceMappingURL=settings.service.js.map