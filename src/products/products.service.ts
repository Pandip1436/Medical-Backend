import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto & { branchId?: string }) {
    if (!createProductDto.barcode?.trim()) createProductDto.barcode = undefined;
    if (createProductDto.barcode && createProductDto.branchId) {
      const existing = await this.prisma.product.findUnique({
        where: { barcode_branchId: { barcode: createProductDto.barcode, branchId: createProductDto.branchId } },
      });
      if (existing) throw new ConflictException('Product with this barcode already exists in this branch');
    }
    return this.prisma.product.create({ data: createProductDto });
  }

  async findAll(opts: {
    query?: string;
    category?: string;
    schedule?: string;
    skip?: number;
    take?: number;
    branchId?: string;
  } = {}) {
    const { query, category, schedule, skip = 0, take, branchId } = opts;

    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (query) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { genericName: { contains: query, mode: 'insensitive' } },
        { manufacturer: { contains: query, mode: 'insensitive' } },
        { barcode: { contains: query, mode: 'insensitive' } },
      ];
    }
    if (category) where.category = category;
    if (schedule) where.schedule = schedule;

    if (take !== undefined) {
      const [data, total] = await Promise.all([
        this.prisma.product.findMany({ where, include: { batches: true }, skip, take, orderBy: { name: 'asc' } }),
        this.prisma.product.count({ where }),
      ]);
      return { data, total };
    }

    return this.prisma.product.findMany({ where, include: { batches: true }, orderBy: { name: 'asc' } });
  }

  async findOne(id: string, branchId?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { batches: true, alternatives: true },
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
    ]);

    return { success: true, batchId, previousQty: batch.quantity, newQty: dto.adjustedQty, diff, reason: dto.reason };
  }

  async bulkAdjustStock(
    items: { productId: string; batchId: string; adjustedQty: number; reason: string }[],
    branchId?: string,
  ) {
    // Validate all items first before touching the DB
    const resolved = await Promise.all(
      items.map(async (item) => {
        const product = await this.prisma.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new NotFoundException(`Product ${item.productId} not found`);
        if (branchId && product.branchId && product.branchId !== branchId) {
          throw new NotFoundException(`Product ${item.productId} not found`);
        }
        const batch = await this.prisma.batch.findFirst({ where: { id: item.batchId, productId: item.productId } });
        if (!batch) throw new NotFoundException(`Batch ${item.batchId} not found`);
        return { ...item, previousQty: batch.quantity, diff: item.adjustedQty - batch.quantity };
      }),
    );

    // Single atomic transaction — all succeed or all fail
    await this.prisma.$transaction(
      resolved.flatMap((item) => [
        this.prisma.batch.update({ where: { id: item.batchId }, data: { quantity: item.adjustedQty } }),
        this.prisma.product.update({ where: { id: item.productId }, data: { totalStock: { increment: item.diff } } }),
      ]),
    );

    return { success: true, adjusted: resolved.length, items: resolved.map(({ productId, batchId, previousQty, adjustedQty, diff, reason }) => ({ productId, batchId, previousQty, newQty: adjustedQty, diff, reason })) };
  }
}
