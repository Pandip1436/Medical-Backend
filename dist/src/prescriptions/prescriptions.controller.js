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
exports.PrescriptionsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const path_1 = require("path");
const uuid_1 = require("uuid");
const prescriptions_service_1 = require("./prescriptions.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const multerOptions = {
    storage: (0, multer_1.diskStorage)({
        destination: './uploads/prescriptions',
        filename: (_req, file, cb) => {
            cb(null, `${(0, uuid_1.v4)()}${(0, path_1.extname)(file.originalname)}`);
        },
    }),
};
let PrescriptionsController = class PrescriptionsController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    upload(file, customerId, doctorName, req, notes, validUntil, bodyBranchId) {
        const effectiveBranchId = req.user.branchId ?? bodyBranchId;
        return this.svc.create(customerId, doctorName, notes, validUntil, file, effectiveBranchId);
    }
    findByCustomer(customerId, req, branchId) {
        const effectiveBranchId = req.user.branchId ?? branchId;
        return this.svc.findByCustomer(customerId, effectiveBranchId);
    }
    findOne(id, req) {
        return this.svc.findOne(id, req.user.branchId);
    }
    remove(id, req) {
        return this.svc.remove(id, req.user.branchId);
    }
};
exports.PrescriptionsController = PrescriptionsController;
__decorate([
    (0, common_1.Post)('upload'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', multerOptions)),
    __param(0, (0, common_1.UploadedFile)(new common_1.ParseFilePipe({
        validators: [
            new common_1.MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
            new common_1.FileTypeValidator({ fileType: /(jpg|jpeg|png|webp|pdf)/ }),
        ],
    }))),
    __param(1, (0, common_1.Body)('customerId')),
    __param(2, (0, common_1.Body)('doctorName')),
    __param(3, (0, common_1.Request)()),
    __param(4, (0, common_1.Body)('notes')),
    __param(5, (0, common_1.Body)('validUntil')),
    __param(6, (0, common_1.Body)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object, String, String, String]),
    __metadata("design:returntype", void 0)
], PrescriptionsController.prototype, "upload", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT'),
    __param(0, (0, common_1.Query)('customerId')),
    __param(1, (0, common_1.Request)()),
    __param(2, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", void 0)
], PrescriptionsController.prototype, "findByCustomer", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'ACCOUNTANT'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PrescriptionsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PrescriptionsController.prototype, "remove", null);
exports.PrescriptionsController = PrescriptionsController = __decorate([
    (0, common_1.Controller)('prescriptions'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [prescriptions_service_1.PrescriptionsService])
], PrescriptionsController);
//# sourceMappingURL=prescriptions.controller.js.map