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
exports.BulkAdjustStockDto = exports.BulkAdjustStockItemDto = exports.AdjustStockDto = void 0;
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
class AdjustStockDto {
    adjustedQty;
    reason;
    notes;
}
exports.AdjustStockDto = AdjustStockDto;
__decorate([
    (0, class_validator_1.IsInt)({ message: 'adjustedQty must be an integer' }),
    (0, class_validator_1.Min)(0, { message: 'adjustedQty cannot be negative' }),
    __metadata("design:type", Number)
], AdjustStockDto.prototype, "adjustedQty", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], AdjustStockDto.prototype, "reason", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], AdjustStockDto.prototype, "notes", void 0);
class BulkAdjustStockItemDto {
    productId;
    batchId;
    adjustedQty;
    reason;
}
exports.BulkAdjustStockItemDto = BulkAdjustStockItemDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], BulkAdjustStockItemDto.prototype, "productId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], BulkAdjustStockItemDto.prototype, "batchId", void 0);
__decorate([
    (0, class_validator_1.IsInt)({ message: 'adjustedQty must be an integer' }),
    (0, class_validator_1.Min)(0, { message: 'adjustedQty cannot be negative' }),
    __metadata("design:type", Number)
], BulkAdjustStockItemDto.prototype, "adjustedQty", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], BulkAdjustStockItemDto.prototype, "reason", void 0);
class BulkAdjustStockDto {
    items;
}
exports.BulkAdjustStockDto = BulkAdjustStockDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => BulkAdjustStockItemDto),
    __metadata("design:type", Array)
], BulkAdjustStockDto.prototype, "items", void 0);
//# sourceMappingURL=adjust-stock.dto.js.map