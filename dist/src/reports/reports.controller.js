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
exports.ReportsController = void 0;
const common_1 = require("@nestjs/common");
const reports_service_1 = require("./reports.service");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
let ReportsController = class ReportsController {
    reportsService;
    constructor(reportsService) {
        this.reportsService = reportsService;
    }
    getDashboardKpis() {
        return this.reportsService.getDashboardKpis();
    }
    getDailySales() {
        return this.reportsService.getDailySales();
    }
    getProductSales() {
        return this.reportsService.getProductSales();
    }
    getStockValuation() {
        return this.reportsService.getStockValuation();
    }
};
exports.ReportsController = ReportsController;
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Get KPI data for the main dashboard' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getDashboardKpis", null);
__decorate([
    (0, common_1.Get)('sales/daily'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Get hourly sales for the current day' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getDailySales", null);
__decorate([
    (0, common_1.Get)('sales/products'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Get sales performance by product' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getProductSales", null);
__decorate([
    (0, common_1.Get)('inventory/valuation'),
    (0, roles_decorator_1.Roles)('ADMIN', 'INVENTORY_MANAGER'),
    (0, swagger_1.ApiOperation)({ summary: 'Get current stock valuation by category' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "getStockValuation", null);
exports.ReportsController = ReportsController = __decorate([
    (0, swagger_1.ApiTags)('reports'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('api/v1/reports'),
    __metadata("design:paramtypes", [reports_service_1.ReportsService])
], ReportsController);
//# sourceMappingURL=reports.controller.js.map