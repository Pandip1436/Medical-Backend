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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsController = void 0;
const common_1 = require("@nestjs/common");
const settings_service_1 = require("./settings.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
let SettingsController = class SettingsController {
    settingsService;
    constructor(settingsService) {
        this.settingsService = settingsService;
    }
    async getBusinessProfile(branchId) {
        return this.settingsService.getBusinessProfile(branchId);
    }
    async updateBusinessProfile(branchId, data) {
        return this.settingsService.updateBusinessProfile(branchId, data);
    }
    async getDiscountRules(branchId) {
        return this.settingsService.getDiscountRules(branchId);
    }
    async createDiscountRule(branchId, data) {
        return this.settingsService.createDiscountRule(branchId, data);
    }
    async updateDiscountRule(id, data) {
        return this.settingsService.updateDiscountRule(id, data);
    }
    async deleteDiscountRule(id) {
        return this.settingsService.deleteDiscountRule(id);
    }
    async getSetting(key) {
        return this.settingsService.getSetting(key);
    }
    async updateSetting(key, value) {
        return this.settingsService.updateSetting(key, value);
    }
};
exports.SettingsController = SettingsController;
__decorate([
    (0, common_1.Get)('business'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER', 'SALESPERSON'),
    __param(0, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getBusinessProfile", null);
__decorate([
    (0, common_1.Put)('business'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Query)('branchId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "updateBusinessProfile", null);
__decorate([
    (0, common_1.Get)('discounts'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER'),
    __param(0, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getDiscountRules", null);
__decorate([
    (0, common_1.Post)('discounts'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Query)('branchId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "createDiscountRule", null);
__decorate([
    (0, common_1.Patch)('discounts/:id'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "updateDiscountRule", null);
__decorate([
    (0, common_1.Delete)('discounts/:id'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "deleteDiscountRule", null);
__decorate([
    (0, common_1.Get)(':key'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'INVENTORY_MANAGER', 'SALESPERSON'),
    __param(0, (0, common_1.Param)('key')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "getSetting", null);
__decorate([
    (0, common_1.Put)(':key'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Param)('key')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "updateSetting", null);
exports.SettingsController = SettingsController = __decorate([
    (0, common_1.Controller)('api/v1/settings'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [settings_service_1.SettingsService])
], SettingsController);
//# sourceMappingURL=settings.controller.js.map