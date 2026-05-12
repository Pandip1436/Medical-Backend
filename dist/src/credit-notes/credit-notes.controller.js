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
exports.CreditNotesController = void 0;
const common_1 = require("@nestjs/common");
const credit_notes_service_1 = require("./credit-notes.service");
const create_credit_note_dto_1 = require("./dto/create-credit-note.dto");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
let CreditNotesController = class CreditNotesController {
    creditNotesService;
    constructor(creditNotesService) {
        this.creditNotesService = creditNotesService;
    }
    create(dto, req) {
        return this.creditNotesService.create(dto, req.user.userId, req.user.branchId, req.user.role);
    }
    findAll(req, q, customerId, branchId) {
        const effectiveBranchId = req.user.branchId ?? branchId;
        return this.creditNotesService.findAll(q, customerId, effectiveBranchId);
    }
    getReturnedQtyByInvoice(invoiceId, req) {
        return this.creditNotesService.getReturnedQtyByInvoice(invoiceId, req.user.branchId);
    }
    findOne(id, req) {
        return this.creditNotesService.findOne(id, req.user.branchId);
    }
};
exports.CreditNotesController = CreditNotesController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST'),
    (0, swagger_1.ApiOperation)({ summary: 'Create a credit note (sales return) for an invoice' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_credit_note_dto_1.CreateCreditNoteDto, Object]),
    __metadata("design:returntype", void 0)
], CreditNotesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'List credit notes or search' }),
    (0, swagger_1.ApiQuery)({ name: 'q', required: false }),
    (0, swagger_1.ApiQuery)({ name: 'customerId', required: false }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('q')),
    __param(2, (0, common_1.Query)('customerId')),
    __param(3, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], CreditNotesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('invoice/:invoiceId/returned-qty'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Already-returned qty per (productId, batchId) for an invoice (includes pending approvals)' }),
    __param(0, (0, common_1.Param)('invoiceId')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CreditNotesController.prototype, "getReturnedQtyByInvoice", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT'),
    (0, swagger_1.ApiOperation)({ summary: 'Get specific credit note by ID' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CreditNotesController.prototype, "findOne", null);
exports.CreditNotesController = CreditNotesController = __decorate([
    (0, swagger_1.ApiTags)('credit-notes'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('api/v1/credit-notes'),
    __metadata("design:paramtypes", [credit_notes_service_1.CreditNotesService])
], CreditNotesController);
//# sourceMappingURL=credit-notes.controller.js.map