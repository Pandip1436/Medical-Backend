import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto & { branchId?: string }) {
    const { categoryId, branchId, ...rest } = createProductDto;
    return this.prisma.product.create({
      data: { ...rest, categoryId, ...(branchId ? { branchId } : {}) } as unknown as Prisma.ProductUncheckedCreateInput,
    });
  }

  async toggleActive(id: string, branchId?: string) {
    const product = await this.findOne(id, branchId);
    return this.prisma.product.update({
      where: { id },
      data: { isActive: !(product as any).isActive } as any,
    });
  }

  async findAll(opts: {
    query?: string;
    categoryId?: string;
    schedule?: string;
    skip?: number;
    take?: number;
    branchId?: string;
    includeInactive?: boolean;
  } = {}) {
    const { query, categoryId, schedule, skip = 0, take, branchId, includeInactive } = opts;

    const where: any = {};
    if (!includeInactive) where.isActive = true;
    if (branchId) where.branchId = branchId;
    if (query) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { genericName: { contains: query, mode: 'insensitive' } },
        { manufacturer: { contains: query, mode: 'insensitive' } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (schedule) where.schedule = schedule;

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

  async findOne(id: string, branchId?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { batches: true, alternatives: true, category: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (branchId && product.branchId && product.branchId !== branchId) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.product.update({ where: { id }, data: updateProductDto });
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.product.delete({ where: { id } });
  }

  async importCsv(buffer: Buffer, branchId?: string): Promise<{ created: number; skipped: number; errors: string[] }> {
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new BadRequestException('CSV must have a header row and at least one data row');

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
    const required = ['name', 'genericname', 'manufacturer', 'category', 'packsize', 'unitofmeasure',
      'schedule', 'hsncode', 'storagecondition', 'mrp', 'purchaserate', 'sellingrate',
      'wholesalerate', 'gstrate', 'minstock', 'maxstock', 'reorderqty', 'racklocation'];
    const missing = required.filter((r) => !headers.includes(r));
    if (missing.length) throw new BadRequestException(`Missing columns: ${missing.join(', ')}`);

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',').map((c) => c.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });

      const rowNum = i + 1;
      try {
        const barcode = row['barcode'] || undefined;
        if (barcode && branchId) {
          const existing = await this.prisma.product.findUnique({
            where: { barcode_branchId: { barcode, branchId } },
          });
          if (existing) { skipped++; continue; }
        }

        await this.prisma.product.create({
          data: {
            name: row['name'],
            genericName: row['genericname'],
            saltComposition: row['saltcomposition'] || undefined,
            manufacturer: row['manufacturer'],
            category: row['category'] as any,
            subCategory: row['subcategory'] || undefined,
            packSize: row['packsize'],
            unitOfMeasure: row['unitofmeasure'],
            schedule: row['schedule'] as any,
            hsnCode: row['hsncode'],
            isNarcotic: row['isnarcotic'] === 'true',
            storageCondition: row['storagecondition'] as any,
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
      } catch (err: any) {
        errors.push(`Row ${rowNum} (${row['name'] || '?'}): ${err.message}`);
      }
    }

    return { created, skipped, errors };
  }

  async adjustBatchStock(
    productId: string,
    batchId: string,
    dto: { adjustedQty: number; reason: string; notes?: string },
    branchId?: string,
    user?: { userId: string; name: string },
  ) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (branchId && product.branchId && product.branchId !== branchId) {
      throw new NotFoundException('Product not found');
    }
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, productId } });
    if (!batch) throw new NotFoundException('Batch not found for this product');

    const diff = dto.adjustedQty - batch.quantity;

    await this.prisma.$transaction([
      this.prisma.batch.update({ where: { id: batchId }, data: { quantity: dto.adjustedQty } }),
      this.prisma.product.update({ where: { id: productId }, data: { totalStock: { increment: diff } } }),
      ...(user ? [(this.prisma as any).stockAdjustmentLog.create({ data: {
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
      }})] : []),
    ]);

    return { success: true, batchId, previousQty: batch.quantity, newQty: dto.adjustedQty, diff, reason: dto.reason };
  }

  async getProductHistory(productId: string, branchId?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { batches: true, category: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (branchId && product.branchId && product.branchId !== branchId) {
      throw new NotFoundException('Product not found');
    }

    const salesItems = await this.prisma.invoiceItem.findMany({
      where: { productId },
      include: {
        invoice: {
          select: { invoiceNumber: true, date: true, customerName: true, status: true },
        },
      },
      orderBy: { invoice: { date: 'desc' } },
      take: 100,
    });

    const purchaseItems = await this.prisma.gRNItem.findMany({
      where: { productId },
      include: {
        grn: {
          select: { grnNumber: true, date: true, supplierName: true, status: true },
        },
      },
      orderBy: { grn: { date: 'desc' } },
      take: 100,
    });

    const totalSoldQty = salesItems.reduce((sum, i) => sum + i.quantity, 0);
    const totalPurchasedQty = purchaseItems.reduce((sum, i) => sum + i.receivedQty, 0);
    const totalSalesValue = salesItems.reduce((sum, i) => sum + Number(i.amount), 0);
    const totalPurchaseValue = purchaseItems.reduce((sum, i) => sum + Number(i.purchaseRate) * i.receivedQty, 0);
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
        totalSoldQty,
        totalPurchasedQty,
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
    };
  }

  async bulkAdjustStock(
    items: { productId: string; batchId: string; adjustedQty: number; reason: string }[],
    branchId?: string,
    user?: { userId: string; name: string },
  ) {
    const resolved = await Promise.all(
      items.map(async (item) => {
        const product = await this.prisma.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new NotFoundException(`Product ${item.productId} not found`);
        if (branchId && product.branchId && product.branchId !== branchId) {
          throw new NotFoundException(`Product ${item.productId} not found`);
        }
        const batch = await this.prisma.batch.findFirst({ where: { id: item.batchId, productId: item.productId } });
        if (!batch) throw new NotFoundException(`Batch ${item.batchId} not found`);
        return { ...item, previousQty: batch.quantity, diff: item.adjustedQty - batch.quantity, branchId: product.branchId, batchNumber: batch.batchNumber };
      }),
    );

    await this.prisma.$transaction([
      ...resolved.flatMap((item) => [
        this.prisma.batch.update({ where: { id: item.batchId }, data: { quantity: item.adjustedQty } }),
        this.prisma.product.update({ where: { id: item.productId }, data: { totalStock: { increment: item.diff } } }),
      ]),
      ...(user ? resolved.map((item) =>
        (this.prisma as any).stockAdjustmentLog.create({ data: {
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
        }})
      ) : []),
    ]);

    return { success: true, adjusted: resolved.length, items: resolved.map(({ productId, batchId, previousQty, adjustedQty, diff, reason }) => ({ productId, batchId, previousQty, newQty: adjustedQty, diff, reason })) };
  }
}
