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
exports.PurchaseReturnsController = void 0;
const common_1 = require("@nestjs/common");
const purchase_returns_service_1 = require("./purchase-returns.service");
const create_purchase_return_dto_1 = require("./dto/create-purchase-return.dto");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
let PurchaseReturnsController = class PurchaseReturnsController {
    purchaseReturnsService;
    constructor(purchaseReturnsService) {
        this.purchaseReturnsService = purchaseReturnsService;
    }
    create(dto, req) {
        return this.purchaseReturnsService.create(dto, req.user.userId, req.user.branchId);
    }
    findAll(req, q, branchId) {
        const effectiveBranchId = req.user.branchId ?? branchId;
        return this.purchaseReturnsService.findAll(q, effectiveBranchId);
    }
    findOne(id, req) {
        return this.purchaseReturnsService.findOne(id, req.user.branchId);
    }
    updateStatus(id, status, req) {
        return this.purchaseReturnsService.updateStatus(id, status, req.user.branchId);
    }
};
exports.PurchaseReturnsController = PurchaseReturnsController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Create a purchase return / debit note to supplier' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_purchase_return_dto_1.CreatePurchaseReturnDto, Object]),
    __metadata("design:returntype", void 0)
], PurchaseReturnsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'List purchase returns or search' }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'q', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('q')),
    __param(2, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], PurchaseReturnsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Get specific purchase return by ID' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PurchaseReturnsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Update purchase return status' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)('status')),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], PurchaseReturnsController.prototype, "updateStatus", null);
exports.PurchaseReturnsController = PurchaseReturnsController = __decorate([
    (0, swagger_1.ApiTags)('purchase-returns'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('api/v1/purchase-returns'),
    __metadata("design:paramtypes", [purchase_returns_service_1.PurchaseReturnsService])
], PurchaseReturnsController);
//# sourceMappingURL=purchase-returns.controller.js.map