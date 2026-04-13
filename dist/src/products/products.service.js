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
exports.ProductsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ProductsService = class ProductsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createProductDto) {
        if (createProductDto.barcode) {
            const existing = await this.prisma.product.findUnique({
                where: { barcode: createProductDto.barcode }
            });
            if (existing)
                throw new common_1.ConflictException('Product with this barcode already exists');
        }
        return this.prisma.product.create({
            data: createProductDto,
        });
    }
    async findAll(query) {
        if (query) {
            return this.prisma.product.findMany({
                where: {
                    OR: [
                        { name: { contains: query, mode: 'insensitive' } },
                        { genericName: { contains: query, mode: 'insensitive' } },
                        { barcode: { contains: query, mode: 'insensitive' } },
                    ],
                },
                include: { batches: true }
            });
        }
        return this.prisma.product.findMany({
            include: { batches: true }
        });
    }
    async findOne(id) {
        const product = await this.prisma.product.findUnique({
            where: { id },
            include: { batches: true, alternatives: true }
        });
        if (!product)
            throw new common_1.NotFoundException('Product not found');
        return product;
    }
    async update(id, updateProductDto) {
        await this.findOne(id);
        if (updateProductDto.barcode) {
            const existing = await this.prisma.product.findUnique({
                where: { barcode: updateProductDto.barcode }
            });
            if (existing && existing.id !== id) {
                throw new common_1.ConflictException('Barcode is already assigned to a different product');
            }
        }
        return this.prisma.product.update({
            where: { id },
            data: updateProductDto,
        });
    }
    async remove(id) {
        await this.findOne(id);
        return this.prisma.product.delete({
            where: { id },
        });
    }
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ProductsService);
//# sourceMappingURL=products.service.js.map