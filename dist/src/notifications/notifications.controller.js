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
exports.NotificationsController = void 0;
const common_1 = require("@nestjs/common");
const notifications_service_1 = require("./notifications.service");
const create_notification_dto_1 = require("./dto/create-notification.dto");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const swagger_1 = require("@nestjs/swagger");
let NotificationsController = class NotificationsController {
    service;
    constructor(service) {
        this.service = service;
    }
    findAll(req, queryBranchId, unread) {
        const branchId = req.user.branchId ?? queryBranchId ?? undefined;
        return this.service.findAll(branchId, unread === 'true');
    }
    create(dto, req, queryBranchId) {
        if (!dto.branchId)
            dto.branchId = req.user.branchId ?? queryBranchId ?? undefined;
        return this.service.create(dto);
    }
    markAsRead(id) {
        return this.service.markAsRead(id);
    }
    markAllAsRead(req, queryBranchId) {
        const branchId = req.user.branchId ?? queryBranchId ?? undefined;
        return this.service.markAllAsRead(branchId);
    }
    markManyAsRead(body) {
        return this.service.markManyAsRead(body?.ids ?? []);
    }
    snooze(id, body) {
        return this.service.snooze(id, new Date(body.until));
    }
    resolve(id, req) {
        return this.service.resolve(id, req.user.userId);
    }
    remove(id) {
        return this.service.remove(id);
    }
    removeMany(body) {
        return this.service.removeMany(body?.ids ?? []);
    }
    clearAll(req, queryBranchId) {
        const branchId = req.user.branchId ?? queryBranchId ?? undefined;
        return this.service.clearAll(branchId);
    }
    generateLowStock(req, queryBranchId) {
        const branchId = req.user.branchId ?? queryBranchId ?? undefined;
        return this.service.generateLowStockAlerts(branchId);
    }
    generateExpiry(req, queryBranchId, days) {
        const branchId = req.user.branchId ?? queryBranchId ?? undefined;
        return this.service.generateExpiryAlerts(branchId, days ? parseInt(days) : 90);
    }
    generatePaymentDue(req, queryBranchId) {
        const branchId = req.user.branchId ?? queryBranchId ?? undefined;
        return this.service.generatePaymentDueAlerts(branchId);
    }
    async generateAll(req, queryBranchId) {
        const branchId = req.user.branchId ?? queryBranchId ?? undefined;
        const [lowStock, expiry, paymentDue] = await Promise.all([
            this.service.generateLowStockAlerts(branchId),
            this.service.generateExpiryAlerts(branchId),
            this.service.generatePaymentDueAlerts(branchId),
        ]);
        return { lowStock, expiry, paymentDue };
    }
};
exports.NotificationsController = NotificationsController;
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __param(2, (0, common_1.Query)('unread')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_notification_dto_1.CreateNotificationDto, Object, String]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id/read'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "markAsRead", null);
__decorate([
    (0, common_1.Patch)('read-all'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "markAllAsRead", null);
__decorate([
    (0, common_1.Patch)('read-bulk'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "markManyAsRead", null);
__decorate([
    (0, common_1.Patch)(':id/snooze'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "snooze", null);
__decorate([
    (0, common_1.Patch)(':id/resolve'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "resolve", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)('delete-bulk'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "removeMany", null);
__decorate([
    (0, common_1.Delete)(),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "clearAll", null);
__decorate([
    (0, common_1.Post)('generate/low-stock'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "generateLowStock", null);
__decorate([
    (0, common_1.Post)('generate/expiry'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __param(2, (0, common_1.Query)('days')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "generateExpiry", null);
__decorate([
    (0, common_1.Post)('generate/payment-due'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], NotificationsController.prototype, "generatePaymentDue", null);
__decorate([
    (0, common_1.Post)('generate/all'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], NotificationsController.prototype, "generateAll", null);
exports.NotificationsController = NotificationsController = __decorate([
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('api/v1/notifications'),
    __metadata("design:paramtypes", [notifications_service_1.NotificationsService])
], NotificationsController);
//# sourceMappingURL=notifications.controller.js.map