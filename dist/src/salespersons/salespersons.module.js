"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SalespersonsModule = void 0;
const common_1 = require("@nestjs/common");
const salespersons_controller_1 = require("./salespersons.controller");
const salespersons_service_1 = require("./salespersons.service");
const prisma_module_1 = require("../prisma/prisma.module");
const users_module_1 = require("../users/users.module");
let SalespersonsModule = class SalespersonsModule {
};
exports.SalespersonsModule = SalespersonsModule;
exports.SalespersonsModule = SalespersonsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, users_module_1.UsersModule],
        controllers: [salespersons_controller_1.SalespersonsController],
        providers: [salespersons_service_1.SalespersonsService],
        exports: [salespersons_service_1.SalespersonsService],
    })
], SalespersonsModule);
//# sourceMappingURL=salespersons.module.js.map