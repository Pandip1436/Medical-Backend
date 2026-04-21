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
exports.SalespersonsController = void 0;
const common_1 = require("@nestjs/common");
const salespersons_service_1 = require("./salespersons.service");
const users_service_1 = require("../users/users.service");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
const roles_guard_1 = require("../common/guards/roles.guard");
const roles_decorator_1 = require("../common/decorators/roles.decorator");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
class CreateSalespersonDto {
    name;
    email;
    phone;
    password;
    branchId;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateSalespersonDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsEmail)(),
    __metadata("design:type", String)
], CreateSalespersonDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateSalespersonDto.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(6),
    __metadata("design:type", String)
], CreateSalespersonDto.prototype, "password", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateSalespersonDto.prototype, "branchId", void 0);
class UpdateSalespersonDto {
    name;
    email;
    phone;
    password;
    branchId;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdateSalespersonDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsEmail)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdateSalespersonDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdateSalespersonDto.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(6),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdateSalespersonDto.prototype, "password", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdateSalespersonDto.prototype, "branchId", void 0);
let SalespersonsController = class SalespersonsController {
    salespersonsService;
    usersService;
    constructor(salespersonsService, usersService) {
        this.salespersonsService = salespersonsService;
        this.usersService = usersService;
    }
    findAll(branchId) {
        return this.salespersonsService.findAll(branchId);
    }
    create(dto) {
        return this.usersService.create({
            ...dto,
            role: 'SALESPERSON',
        });
    }
    update(id, dto, req) {
        return this.usersService.update(id, dto, req.user.branchId);
    }
    async toggle(id, req) {
        const user = await this.usersService.findOne(id, req.user.branchId);
        return this.usersService.update(id, { isActive: !user.isActive }, req.user.branchId);
    }
    getReport(branchId, from, to) {
        return this.salespersonsService.getReport(branchId, from, to);
    }
    getStats(id, branchId) {
        return this.salespersonsService.getStats(id, branchId);
    }
};
exports.SalespersonsController = SalespersonsController;
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)('ADMIN', 'PHARMACIST', 'SALESPERSON'),
    __param(0, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SalespersonsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [CreateSalespersonDto]),
    __metadata("design:returntype", void 0)
], SalespersonsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateSalespersonDto, Object]),
    __metadata("design:returntype", void 0)
], SalespersonsController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(':id/toggle'),
    (0, roles_decorator_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SalespersonsController.prototype, "toggle", null);
__decorate([
    (0, common_1.Get)('report'),
    (0, roles_decorator_1.Roles)('ADMIN', 'ACCOUNTANT'),
    __param(0, (0, common_1.Query)('branchId')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], SalespersonsController.prototype, "getReport", null);
__decorate([
    (0, common_1.Get)(':id/stats'),
    (0, roles_decorator_1.Roles)('ADMIN', 'SALESPERSON'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], SalespersonsController.prototype, "getStats", null);
exports.SalespersonsController = SalespersonsController = __decorate([
    (0, swagger_1.ApiTags)('salespersons'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('api/v1/salespersons'),
    __metadata("design:paramtypes", [salespersons_service_1.SalespersonsService,
        users_service_1.UsersService])
], SalespersonsController);
//# sourceMappingURL=salespersons.controller.js.map