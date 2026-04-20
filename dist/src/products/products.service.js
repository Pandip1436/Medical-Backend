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
        if (createProductDto.barcode && createProductDto.branchId) {
            const existing = await this.prisma.product.findUnique({
                where: { barcode_branchId: { barcode: createProductDto.barcode, branchId: createProductDto.branchId } },
            });
            if (existing)
                throw new common_1.ConflictException('Product with this barcode already exists in this branch');
        }
        return this.prisma.product.create({ data: createProductDto });
    }
    async findAll(opts = {}) {
        const { query, category, schedule, skip = 0, take, branchId } = opts;
        const where = {};
        if (branchId)
            where.branchId = branchId;
        if (query) {
            where.OR = [
                { name: { contains: query, mode: 'insensitive' } },
                { genericName: { contains: query, mode: 'insensitive' } },
                { manufacturer: { contains: query, mode: 'insensitive' } },
                { barcode: { contains: query, mode: 'insensitive' } },
            ];
        }
        if (category)
            where.category = category;
        if (schedule)
            where.schedule = schedule;
        if (take !== undefined) {
            const [data, total] = await Promise.all([
                this.prisma.product.findMany({ where, include: { batches: true }, skip, take, orderBy: { name: 'asc' } }),
                this.prisma.product.count({ where }),
            ]);
            return { data, total };
        }
        return this.prisma.product.findMany({ where, include: { batches: true }, orderBy: { name: 'asc' } });
    }
    async findOne(id, branchId) {
        const product = await this.prisma.product.findUnique({
            where: { id },
            include: { batches: true, alternatives: true },
        });
        if (!product)
            throw new common_1.NotFoundException('Product not found');
        if (branchId && product.branchId && product.branchId !== branchId) {
            throw new common_1.NotFoundException('Product not found');
        }
        return product;
    }
    async update(id, updateProductDto, branchId) {
        await this.findOne(id, branchId);
        return this.prisma.product.update({ where: { id }, data: updateProductDto });
    }
    async remove(id, branchId) {
        await this.findOne(id, branchId);
        return this.prisma.product.delete({ where: { id } });
    }
    async importCsv(buffer, branchId) {
        const text = buffer.toString('utf-8');
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2)
            throw new common_1.BadRequestException('CSV must have a header row and at least one data row');
        const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
        const required = ['name', 'genericname', 'manufacturer', 'category', 'packsize', 'unitofmeasure',
            'schedule', 'hsncode', 'storagecondition', 'mrp', 'purchaserate', 'sellingrate',
            'wholesalerate', 'gstrate', 'minstock', 'maxstock', 'reorderqty', 'racklocation'];
        const missing = required.filter((r) => !headers.includes(r));
        if (missing.length)
            throw new common_1.BadRequestException(`Missing columns: ${missing.join(', ')}`);
        let created = 0;
        let skipped = 0;
        const errors = [];
        for (let i = 1; i < lines.length; i++) {
            const cells = lines[i].split(',').map((c) => c.trim());
            const row = {};
            headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
            const rowNum = i + 1;
            try {
                const barcode = row['barcode'] || undefined;
                if (barcode && branchId) {
                    const existing = await this.prisma.product.findUnique({
                        where: { barcode_branchId: { barcode, branchId } },
                    });
                    if (existing) {
                        skipped++;
                        continue;
                    }
                }
                await this.prisma.product.create({
                    data: {
                        name: row['name'],
                        genericName: row['genericname'],
                        saltComposition: row['saltcomposition'] || undefined,
                        manufacturer: row['manufacturer'],
                        category: row['category'],
                        subCategory: row['subcategory'] || undefined,
                        packSize: row['packsize'],
                        unitOfMeasure: row['unitofmeasure'],
                        schedule: row['schedule'],
                        hsnCode: row['hsncode'],
                        isNarcotic: row['isnarcotic'] === 'true',
                        storageCondition: row['storagecondition'],
                        mrp: parseFloat(row['mrp']) || 0,
                        purchaseRate: parseFloat(row['purchaserate']) || 0,
                        sellingRate: parseFloat(row['sellingrate']) || 0,
                        wholesaleRate: parseFloat(row['wholesalerate']) || 0,
                        gstRate: parseFloat(row['gstrate']) || 0,
                        minStock: parseInt(row['minstock']) || 0,
                        maxStock: parseInt(row['maxstock']) || 0,
                        reorderQty: parseInt(row['reorderqty']) || 0,
                        rackLocation: row['racklocation'],
                        barcode,
                        branchId: branchId || undefined,
                    },
                });
                created++;
            }
            catch (err) {
                errors.push(`Row ${rowNum} (${row['name'] || '?'}): ${err.message}`);
            }
        }
        return { created, skipped, errors };
    }
    async adjustBatchStock(productId, batchId, dto, branchId) {
        const product = await this.prisma.product.findUnique({ where: { id: productId } });
        if (!product)
            throw new common_1.NotFoundException('Product not found');
        if (branchId && product.branchId && product.branchId !== branchId) {
            throw new common_1.NotFoundException('Product not found');
        }
        const batch = await this.prisma.batch.findFirst({ where: { id: batchId, productId } });
        if (!batch)
            throw new common_1.NotFoundException('Batch not found for this product');
        const diff = dto.adjustedQty - batch.quantity;
        await this.prisma.$transaction([
            this.prisma.batch.update({ where: { id: batchId }, data: { quantity: dto.adjustedQty } }),
            this.prisma.product.update({ where: { id: productId }, data: { totalStock: { increment: diff } } }),
        ]);
        return { success: true, batchId, previousQty: batch.quantity, newQty: dto.adjustedQty, diff, reason: dto.reason };
    }
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ProductsService);
//# sourceMappingURL=products.service.js.map