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
exports.CreateGrnItemDto = void 0;
const class_validator_1 = require("class-validator");
let ExpiryAfterMfgAndFuture = class ExpiryAfterMfgAndFuture {
    validate(value, args) {
        const obj = args.object;
        const expiry = new Date(value);
        if (Number.isNaN(expiry.getTime()))
            return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (expiry < today)
            return false;
        if (obj.mfgDate) {
            const mfg = new Date(obj.mfgDate);
            if (!Number.isNaN(mfg.getTime()) && expiry < mfg)
                return false;
        }
        return true;
    }
    defaultMessage() {
        return 'expiryDate must be on or after today and not earlier than mfgDate';
    }
};
ExpiryAfterMfgAndFuture = __decorate([
    (0, class_validator_1.ValidatorConstraint)({ name: 'expiryAfterMfgAndFuture', async: false })
], ExpiryAfterMfgAndFuture);
let MfgNotInFuture = class MfgNotInFuture {
    validate(value) {
        const mfg = new Date(value);
        if (Number.isNaN(mfg.getTime()))
            return false;
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        return mfg <= today;
    }
    defaultMessage() {
        return 'mfgDate cannot be in the future';
    }
};
MfgNotInFuture = __decorate([
    (0, class_validator_1.ValidatorConstraint)({ name: 'mfgNotInFuture', async: false })
], MfgNotInFuture);
class CreateGrnItemDto {
    productId;
    productName;
    orderedQty;
    receivedQty;
    freeQty;
    batchNumber;
    mfgDate;
    expiryDate;
    purchaseRate;
    mrp;
    damageQty;
}
exports.CreateGrnItemDto = CreateGrnItemDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateGrnItemDto.prototype, "productId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateGrnItemDto.prototype, "productName", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateGrnItemDto.prototype, "orderedQty", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateGrnItemDto.prototype, "receivedQty", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateGrnItemDto.prototype, "freeQty", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateGrnItemDto.prototype, "batchNumber", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.Validate)(MfgNotInFuture),
    __metadata("design:type", String)
], CreateGrnItemDto.prototype, "mfgDate", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.Validate)(ExpiryAfterMfgAndFuture),
    __metadata("design:type", String)
], CreateGrnItemDto.prototype, "expiryDate", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateGrnItemDto.prototype, "purchaseRate", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateGrnItemDto.prototype, "mrp", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(0),
    __metadata("design:type", Number)
], CreateGrnItemDto.prototype, "damageQty", void 0);
//# sourceMappingURL=create-grn-item.dto.js.map