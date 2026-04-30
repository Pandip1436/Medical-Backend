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
        const { categoryId, branchId, ...rest } = createProductDto;
        return this.prisma.product.create({
            data: { ...rest, categoryId, ...(branchId ? { branchId } : {}) },
        });
    }
    async toggleActive(id, branchId) {
        const product = await this.findOne(id, branchId);
        return this.prisma.product.update({
            where: { id },
            data: { isActive: !product.isActive },
        });
    }
    async findAll(opts = {}) {
        const { query, categoryId, schedule, skip = 0, take, branchId, includeInactive, status } = opts;
        const where = {};
        if (status === 'active')
            where.isActive = true;
        else if (status === 'inactive')
            where.isActive = false;
        else if (!includeInactive)
            where.isActive = true;
        if (branchId)
            where.branchId = branchId;
        if (query) {
            where.OR = [
                { name: { contains: query, mode: 'insensitive' } },
                { genericName: { contains: query, mode: 'insensitive' } },
                { manufacturer: { contains: query, mode: 'insensitive' } },
            ];
        }
        if (categoryId)
            where.categoryId = categoryId;
        if (schedule)
            where.schedule = schedule;
        const include = { batches: true, category: true };
        if (take !== undefined) {
            const [data, total] = await Promise.all([
                this.prisma.product.findMany({ where, include, skip, take, orderBy: { name: 'asc' } }),
                this.prisma.product.count({ where }),
            ]);
            return { data, total };
        }
        return this.prisma.product.findMany({ where, include, orderBy: { name: 'asc' } });
    }
    async findOne(id, branchId) {
        const product = await this.prisma.product.findUnique({
            where: { id },
            include: { batches: true, alternatives: true, category: true },
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
        const allCategories = await this.prisma.category.findMany({ select: { id: true, name: true } });
        const categoryByName = new Map(allCategories.map((c) => [c.name.toLowerCase().trim(), c.id]));
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
                const categoryId = row['category']
                    ? categoryByName.get(row['category'].toLowerCase().trim()) ?? undefined
                    : undefined;
                await this.prisma.product.create({
                    data: {
                        name: row['name'],
                        genericName: row['genericname'],
                        saltComposition: row['saltcomposition'] || undefined,
                        manufacturer: row['manufacturer'],
                        categoryId,
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
    async adjustBatchStock(productId, batchId, dto, branchId, user) {
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
            ...(user ? [this.prisma.stockAdjustmentLog.create({ data: {
                        productId,
                        batchId,
                        batchNumber: batch.batchNumber,
                        userId: user.userId,
                        userName: user.name,
                        reason: dto.reason,
                        previousQty: batch.quantity,
                        adjustedQty: dto.adjustedQty,
                        diff,
                        notes: dto.notes ?? null,
                        branchId: product.branchId ?? branchId ?? null,
                    } })] : []),
        ]);
        return { success: true, batchId, previousQty: batch.quantity, newQty: dto.adjustedQty, diff, reason: dto.reason };
    }
    async getProductHistory(productId, branchId, opts = {}) {
        const { skip = 0, take = 100 } = opts;
        const product = await this.prisma.product.findUnique({
            where: { id: productId },
            include: { batches: true, category: true },
        });
        if (!product)
            throw new common_1.NotFoundException('Product not found');
        if (branchId && product.branchId && product.branchId !== branchId) {
            throw new common_1.NotFoundException('Product not found');
        }
        const [totalSalesCount, totalPurchaseCount, totalSalesReturnCount, totalPurchaseReturnCount] = await Promise.all([
            this.prisma.invoiceItem.count({ where: { productId } }),
            this.prisma.gRNItem.count({ where: { productId } }),
            this.prisma.creditNoteItem.count({ where: { productId } }),
            this.prisma.purchaseReturnItem.count({ where: { productId } }),
        ]);
        const [salesItems, purchaseItems, salesReturnItems, purchaseReturnItems] = await Promise.all([
            this.prisma.invoiceItem.findMany({
                where: { productId },
                include: {
                    invoice: { select: { invoiceNumber: true, date: true, customerName: true, status: true } },
                },
                orderBy: { invoice: { date: 'desc' } },
                skip,
                take,
            }),
            this.prisma.gRNItem.findMany({
                where: { productId },
                include: {
                    grn: { select: { grnNumber: true, date: true, supplierName: true, status: true } },
                },
                orderBy: { grn: { date: 'desc' } },
                skip,
                take,
            }),
            this.prisma.creditNoteItem.findMany({
                where: { productId },
                include: {
                    creditNote: { select: { creditNoteNo: true, date: true, customerName: true, settlementMode: true, reason: true } },
                },
                orderBy: { creditNote: { date: 'desc' } },
                skip,
                take,
            }),
            this.prisma.purchaseReturnItem.findMany({
                where: { productId },
                include: {
                    purchaseReturn: { select: { debitNoteNo: true, date: true, supplierName: true, status: true, reason: true } },
                },
                orderBy: { purchaseReturn: { date: 'desc' } },
                skip,
                take,
            }),
        ]);
        const totalSoldQty = salesItems.reduce((sum, i) => sum + i.quantity, 0);
        const totalPurchasedQty = purchaseItems.reduce((sum, i) => sum + i.receivedQty, 0);
        const totalSalesValue = salesItems.reduce((sum, i) => sum + Number(i.amount), 0);
        const totalPurchaseValue = purchaseItems.reduce((sum, i) => sum + Number(i.purchaseRate) * i.receivedQty, 0);
        const totalSalesReturnQty = salesReturnItems.reduce((sum, i) => sum + i.returnedQty, 0);
        const totalPurchaseReturnQty = purchaseReturnItems.reduce((sum, i) => sum + i.returnedQty, 0);
        const activeBatches = product.batches.filter((b) => b.quantity > 0).length;
        return {
            product: {
                id: product.id,
                name: product.name,
                genericName: product.genericName,
                manufacturer: product.manufacturer,
                category: product.category,
                totalStock: product.totalStock,
                batchCount: product.batches.length,
                activeBatches,
            },
            summary: {
                salesCount: salesItems.length,
                purchaseCount: purchaseItems.length,
                salesReturnCount: salesReturnItems.length,
                purchaseReturnCount: purchaseReturnItems.length,
                totalSalesCount,
                totalPurchaseCount,
                totalSalesReturnCount,
                totalPurchaseReturnCount,
                totalSoldQty,
                totalPurchasedQty,
                totalSalesReturnQty,
                totalPurchaseReturnQty,
                totalSalesValue,
                totalPurchaseValue,
                currentStock: product.totalStock,
            },
            sales: salesItems.map((i) => ({
                id: i.id,
                invoiceNumber: i.invoice.invoiceNumber,
                date: i.invoice.date,
                customerName: i.invoice.customerName,
                status: i.invoice.status,
                batchNumber: i.batchNumber,
                quantity: i.quantity,
                rate: Number(i.rate),
                amount: Number(i.amount),
                gstPercent: Number(i.gstPercent),
                discountPercent: Number(i.discountPercent),
            })),
            purchases: purchaseItems.map((i) => ({
                id: i.id,
                grnNumber: i.grn.grnNumber,
                date: i.grn.date,
                supplierName: i.grn.supplierName,
                status: i.grn.status,
                batchNumber: i.batchNumber,
                receivedQty: i.receivedQty,
                freeQty: i.freeQty,
                purchaseRate: Number(i.purchaseRate),
                mrp: Number(i.mrp),
                amount: Number(i.purchaseRate) * i.receivedQty,
            })),
            salesReturns: salesReturnItems.map((i) => ({
                id: i.id,
                creditNoteNo: i.creditNote.creditNoteNo,
                date: i.creditNote.date,
                customerName: i.creditNote.customerName,
                settlementMode: i.creditNote.settlementMode,
                reason: i.creditNote.reason,
                batchNumber: i.batchNumber,
                returnedQty: i.returnedQty,
                rate: Number(i.rate),
                amount: Number(i.amount),
                gstPercent: Number(i.gstPercent),
            })),
            purchaseReturns: purchaseReturnItems.map((i) => ({
                id: i.id,
                debitNoteNo: i.purchaseReturn.debitNoteNo,
                date: i.purchaseReturn.date,
                supplierName: i.purchaseReturn.supplierName,
                status: i.purchaseReturn.status,
                reason: i.purchaseReturn.reason,
                batchNumber: i.batchNumber,
                returnedQty: i.returnedQty,
                purchaseRate: Number(i.purchaseRate),
                amount: Number(i.amount),
                gstPercent: Number(i.gstPercent),
            })),
        };
    }
    async bulkAdjustStock(items, branchId, user) {
        const resolved = await Promise.all(items.map(async (item) => {
            const product = await this.prisma.product.findUnique({ where: { id: item.productId } });
            if (!product)
                throw new common_1.NotFoundException(`Product ${item.productId} not found`);
            if (branchId && product.branchId && product.branchId !== branchId) {
                throw new common_1.NotFoundException(`Product ${item.productId} not found`);
            }
            const batch = await this.prisma.batch.findFirst({ where: { id: item.batchId, productId: item.productId } });
            if (!batch)
                throw new common_1.NotFoundException(`Batch ${item.batchId} not found`);
            return { ...item, previousQty: batch.quantity, diff: item.adjustedQty - batch.quantity, branchId: product.branchId, batchNumber: batch.batchNumber };
        }));
        await this.prisma.$transaction([
            ...resolved.flatMap((item) => [
                this.prisma.batch.update({ where: { id: item.batchId }, data: { quantity: item.adjustedQty } }),
                this.prisma.product.update({ where: { id: item.productId }, data: { totalStock: { increment: item.diff } } }),
            ]),
            ...(user ? resolved.map((item) => this.prisma.stockAdjustmentLog.create({ data: {
                    productId: item.productId,
                    batchId: item.batchId,
                    batchNumber: item.batchNumber,
                    userId: user.userId,
                    userName: user.name,
                    reason: item.reason,
                    previousQty: item.previousQty,
                    adjustedQty: item.adjustedQty,
                    diff: item.diff,
                    branchId: item.branchId ?? branchId ?? null,
                } })) : []),
        ]);
        return { success: true, adjusted: resolved.length, items: resolved.map(({ productId, batchId, previousQty, adjustedQty, diff, reason }) => ({ productId, batchId, previousQty, newQty: adjustedQty, diff, reason })) };
    }
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ProductsService);
//# sourceMappingURL=products.service.js.map