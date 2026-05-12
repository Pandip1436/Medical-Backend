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
exports.GrnController = void 0;
const common_1 = require("@nestjs/common");
const grn_service_1 = require("./grn.service");
const create_grn_dto_1 = require("./dto/create-grn.dto");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
let GrnController = class GrnController {
    grnService;
    constructor(grnService) {
        this.grnService = grnService;
    }
    create(createGrnDto, req, branchId) {
        const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
        return this.grnService.create(createGrnDto, effectiveBranchId);
    }
    findAll(req, q, branchId, page, pageSize) {
        const effectiveBranchId = req.user.branchId ?? branchId ?? undefined;
        const pageNum = page ? Number(page) : undefined;
        const pageSizeNum = pageSize ? Number(pageSize) : undefined;
        return this.grnService.findAll(q, effectiveBranchId, pageNum, pageSizeNum);
    }
    backfill() {
        return this.grnService.backfillPoReceivedQty();
    }
    backfillGrnOrdered() {
        return this.grnService.backfillGrnOrderedQty();
    }
    backfillSupplierOutstanding() {
        return this.grnService.backfillSupplierOutstanding();
    }
    backfillPoStatusDN() {
        return this.grnService.backfillPoStatusWithDebitNotes();
    }
    reverseShortDeliveryStock() {
        return this.grnService.reverseShortDeliveryStockDeduction();
    }
    findOne(id, req) {
        return this.grnService.findOne(id, req.user.branchId ?? undefined);
    }
};
exports.GrnController = GrnController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({
        summary: 'Create a new Goods Receipt Note and spawn batches',
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_grn_dto_1.CreateGrnDto, Object, String]),
    __metadata("design:returntype", void 0)
], GrnController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({
        summary: 'List all GRNs or search (paginated when ?page is set)',
    }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    (0, swagger_1.ApiQuery)({
        name: 'q',
        required: false,
        description: 'Search term for GRN number or supplier',
    }),
    (0, swagger_1.ApiQuery)({
        name: 'page',
        required: false,
        description: 'Page number (1-indexed). Omit for full list.',
    }),
    (0, swagger_1.ApiQuery)({
        name: 'pageSize',
        required: false,
        description: 'Page size (default 20, max 200)',
    }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('q')),
    __param(2, (0, common_1.Query)('branchId')),
    __param(3, (0, common_1.Query)('page')),
    __param(4, (0, common_1.Query)('pageSize')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], GrnController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('admin/backfill-po-qty'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    (0, swagger_1.ApiOperation)({
        summary: 'Backfill PO receivedQty from existing GRNs (run once after migration)',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], GrnController.prototype, "backfill", null);
__decorate([
    (0, common_1.Get)('admin/backfill-grn-ordered-qty'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    (0, swagger_1.ApiOperation)({
        summary: 'Backfill GRN orderedQty so supplementary GRNs reflect remaining qty at that delivery',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], GrnController.prototype, "backfillGrnOrdered", null);
__decorate([
    (0, common_1.Get)('admin/backfill-supplier-outstanding'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    (0, swagger_1.ApiOperation)({
        summary: 'Backfill supplier currentOutstanding from existing GRNs and ADJUST debit notes',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], GrnController.prototype, "backfillSupplierOutstanding", null);
__decorate([
    (0, common_1.Get)('admin/backfill-po-status-with-debit-notes'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    (0, swagger_1.ApiOperation)({
        summary: 'Recompute PO status including short-delivery debit notes',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], GrnController.prototype, "backfillPoStatusDN", null);
__decorate([
    (0, common_1.Get)('admin/reverse-short-delivery-stock'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    (0, swagger_1.ApiOperation)({
        summary: 'Reverse wrongly-deducted stock for short-delivery debit notes',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], GrnController.prototype, "reverseShortDeliveryStock", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER', 'PHARMACIST', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Get specific GRN details' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], GrnController.prototype, "findOne", null);
exports.GrnController = GrnController = __decorate([
    (0, swagger_1.ApiTags)('grn'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('api/v1/grn'),
    __metadata("design:paramtypes", [grn_service_1.GrnService])
], GrnController);
//# sourceMappingURL=grn.controller.js.map