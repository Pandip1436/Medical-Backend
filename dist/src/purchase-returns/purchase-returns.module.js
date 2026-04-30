"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PurchaseReturnsModule = void 0;
const common_1 = require("@nestjs/common");
const purchase_returns_service_1 = require("./purchase-returns.service");
const purchase_returns_controller_1 = require("./purchase-returns.controller");
const approvals_module_1 = require("../approvals/approvals.module");
let PurchaseReturnsModule = class PurchaseReturnsModule {
};
exports.PurchaseReturnsModule = PurchaseReturnsModule;
exports.PurchaseReturnsModule = PurchaseReturnsModule = __decorate([
    (0, common_1.Module)({
        imports: [approvals_module_1.ApprovalsModule],
        providers: [purchase_returns_service_1.PurchaseReturnsService],
        controllers: [purchase_returns_controller_1.PurchaseReturnsController],
    })
], PurchaseReturnsModule);
//# sourceMappingURL=purchase-returns.module.js.map