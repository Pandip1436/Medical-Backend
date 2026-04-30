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
exports.BillingController = void 0;
const common_1 = require("@nestjs/common");
const billing_service_1 = require("./billing.service");
const create_invoice_dto_1 = require("./dto/create-invoice.dto");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
let BillingController = class BillingController {
    billingService;
    constructor(billingService) {
        this.billingService = billingService;
    }
    create(createInvoiceDto, req, branchId) {
        const effectiveBranchId = req.user.branchId ?? branchId;
        return this.billingService.create(createInvoiceDto, req.user.userId, effectiveBranchId, req.user.role);
    }
    findAll(req, q, customerId, branchId, type) {
        const effectiveBranchId = req.user.branchId ?? branchId;
        return this.billingService.findAll(q, customerId, effectiveBranchId, type);
    }
    findOne(id, req) {
        return this.billingService.findOne(id, req.user.branchId);
    }
    convertToInvoice(id, req) {
        return this.billingService.convertToInvoice(id, req.user.branchId);
    }
    collectPayment(id, amountReceived, paymentMode, req) {
        return this.billingService.collectPayment(id, Number(amountReceived), paymentMode, req.user.branchId);
    }
    update(id, body, req) {
        return this.billingService.update(id, body, req.user.branchId);
    }
    remove(id, req) {
        return this.billingService.remove(id, req.user.branchId);
    }
    async exportTally(req, from, to, branchId, res) {
        const effectiveBranchId = req.user.branchId ?? branchId;
        const xml = await this.billingService.exportTallyXml(from, to, effectiveBranchId);
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', 'attachment; filename="tally-export.xml"');
        res.send(xml);
    }
    async exportCsv(req, from, to, branchId, res) {
        const effectiveBranchId = req.user.branchId ?? branchId;
        const csv = await this.billingService.exportCsv(from, to, effectiveBranchId);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="invoices-export.csv"');
        res.send(csv);
    }
};
exports.BillingController = BillingController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST'),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new invoice transaction' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_invoice_dto_1.CreateInvoiceDto, Object, String]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON'),
    (0, swagger_1.ApiOperation)({ summary: 'Get all invoices or search' }),
    (0, swagger_1.ApiQuery)({ name: 'q', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'customerId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'type', required: false, description: 'INVOICE or QUOTATION' }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('q')),
    __param(2, (0, common_1.Query)('customerId')),
    __param(3, (0, common_1.Query)('branchId')),
    __param(4, (0, common_1.Query)('type')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT', 'SALESPERSON'),
    (0, swagger_1.ApiOperation)({ summary: 'Get specific invoice by ID with items' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id/convert'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST'),
    (0, swagger_1.ApiOperation)({ summary: 'Convert a quotation to an invoice' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "convertToInvoice", null);
__decorate([
    (0, common_1.Patch)(':id/collect-payment'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Collect payment against a credit/partial invoice' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)('amountReceived')),
    __param(2, (0, common_1.Body)('paymentMode')),
    __param(3, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number, String, Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "collectPayment", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST'),
    (0, swagger_1.ApiOperation)({ summary: 'Update invoice fields (e.g. cancel)' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST'),
    (0, swagger_1.ApiOperation)({ summary: 'Delete a quotation or cancelled invoice' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], BillingController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)('export/tally-xml'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Export invoices as Tally-compatible XML' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "exportTally", null);
__decorate([
    (0, common_1.Get)('export/csv'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT', 'PHARMACIST'),
    (0, swagger_1.ApiOperation)({ summary: 'Export invoices as CSV' }),
    (0, swagger_1.ApiQuery)({ name: 'from', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'to', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'branchId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, Object]),
    __metadata("design:returntype", Promise)
], BillingController.prototype, "exportCsv", null);
exports.BillingController = BillingController = __decorate([
    (0, swagger_1.ApiTags)('billing'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('api/v1/billing'),
    __metadata("design:paramtypes", [billing_service_1.BillingService])
], BillingController);
//# sourceMappingURL=billing.controller.js.map