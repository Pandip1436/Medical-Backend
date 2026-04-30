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
exports.ProductsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const products_service_1 = require("./products.service");
const create_product_dto_1 = require("./dto/create-product.dto");
const update_product_dto_1 = require("./dto/update-product.dto");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
let ProductsController = class ProductsController {
    productsService;
    constructor(productsService) {
        this.productsService = productsService;
    }
    importCsv(file, req, branchId) {
        if (!file)
            throw new common_1.BadRequestException('No file uploaded');
        if (!file.originalname.endsWith('.csv') && file.mimetype !== 'text/csv') {
            throw new common_1.BadRequestException('Only CSV files are accepted');
        }
        const effectiveBranchId = req.user.branchId ?? branchId;
        return this.productsService.importCsv(file.buffer, effectiveBranchId);
    }
    create(createProductDto, req, branchId) {
        const effectiveBranchId = req.user.branchId ?? branchId;
        return this.productsService.create({ ...createProductDto, branchId: effectiveBranchId });
    }
    findAll(req, q, categoryId, schedule, skip, take, branchId, status) {
        const effectiveBranchId = req.user.branchId ?? branchId;
        return this.productsService.findAll({
            query: q,
            categoryId,
            schedule,
            status,
            skip: skip !== undefined ? Number(skip) : undefined,
            take: take !== undefined ? Number(take) : undefined,
            branchId: effectiveBranchId,
        });
    }
    getHistory(id, req, skip, take) {
        return this.productsService.getProductHistory(id, req.user.branchId, {
            skip: skip !== undefined ? Number(skip) : undefined,
            take: take !== undefined ? Number(take) : undefined,
        });
    }
    findOne(id, req) {
        return this.productsService.findOne(id, req.user.branchId);
    }
    update(id, updateProductDto, req) {
        return this.productsService.update(id, updateProductDto, req.user.branchId);
    }
    bulkAdjust(body, req) {
        const user = { userId: req.user.userId, name: req.user.name ?? req.user.email ?? 'Unknown' };
        return this.productsService.bulkAdjustStock(body.items, req.user.branchId, user);
    }
    adjust(id, batchId, body, req) {
        const user = { userId: req.user.userId, name: req.user.name ?? req.user.email ?? 'Unknown' };
        return this.productsService.adjustBatchStock(id, batchId, body, req.user.branchId, user);
    }
    toggleActive(id, req) {
        return this.productsService.toggleActive(id, req.user.branchId);
    }
    getAdjustmentLogs(id) {
        return this.productsService['prisma'].stockAdjustmentLog.findMany({
            where: { productId: id },
            orderBy: { createdAt: 'desc' },
            take: 100,
        });
    }
    remove(id, req) {
        return this.productsService.remove(id, req.user.branchId);
    }
};
exports.ProductsController = ProductsController;
__decorate([
    (0, common_1.Post)('import-csv'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Bulk import products from a CSV file' }),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', { storage: (0, multer_1.memoryStorage)() })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "importCsv", null);
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new product' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_product_dto_1.CreateProductDto, Object, String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON'),
    (0, swagger_1.ApiOperation)({ summary: 'Get all products for a branch (paginated when skip/take provided)' }),
    (0, swagger_1.ApiQuery)({ name: 'q', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'categoryId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'schedule', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'skip', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'take', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('q')),
    __param(2, (0, common_1.Query)('categoryId')),
    __param(3, (0, common_1.Query)('schedule')),
    __param(4, (0, common_1.Query)('skip')),
    __param(5, (0, common_1.Query)('take')),
    __param(6, (0, common_1.Query)('branchId')),
    __param(7, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id/history'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT', 'SALESPERSON'),
    (0, swagger_1.ApiOperation)({ summary: 'Get full sales and purchase history for a product' }),
    (0, swagger_1.ApiQuery)({ name: 'skip', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'take', required: false }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Query)('skip')),
    __param(3, (0, common_1.Query)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String, String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "getHistory", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'SALESPERSON'),
    (0, swagger_1.ApiOperation)({ summary: 'Get product details by ID including batches' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Update a product' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_product_dto_1.UpdateProductDto, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('bulk-adjust'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Atomically adjust stock for multiple batches in one transaction' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "bulkAdjust", null);
__decorate([
    (0, common_1.Patch)(':id/batches/:batchId/adjust'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Adjust stock quantity for a specific batch' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Param)('batchId')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "adjust", null);
__decorate([
    (0, common_1.Patch)(':id/toggle-active'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Toggle product active/inactive status (soft delete)' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "toggleActive", null);
__decorate([
    (0, common_1.Get)(':id/adjustment-logs'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Get stock adjustment audit trail for a product' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "getAdjustmentLogs", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    (0, swagger_1.ApiOperation)({ summary: 'Delete a product (Admin only)' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "remove", null);
exports.ProductsController = ProductsController = __decorate([
    (0, swagger_1.ApiTags)('products'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('api/v1/products'),
    __metadata("design:paramtypes", [products_service_1.ProductsService])
], ProductsController);
//# sourceMappingURL=products.controller.js.map