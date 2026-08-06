import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { Prisma } from '@prisma/client';
import { isAdminRole } from '../common/roles.util';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

// Adjustments above this rupee value require admin approval when submitted by
// a non-admin user. Configurable via env so finance can tune it.
const DEFAULT_ADJUSTMENT_APPROVAL_THRESHOLD = 5000;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  // Enforce the pricing sanity rules server-side too so a direct API call
  // (CSV import, scripted update) can't bypass the form validation. All args
  // are coerced from the multitude of input shapes (Decimal | number | string)
  // the various callers hand us; non-finite values are skipped rather than
  // rejected so partial/legacy data doesn't blow up.
  //   - MRP is the legal maximum retail price under the Drugs (Prices Control)
  //     Order, so selling above it is non-negotiable.
  //   - Purchase rate above selling price means every sale loses money.
  //   - Purchase / wholesale rate above MRP can never be recovered at retail.
  // Purchase and wholesale rate are optional (0 = not entered), so their
  // checks only apply when a positive value is present.
  private assertPricingSane(
    sellingRate: unknown,
    mrp: unknown,
    purchaseRate?: unknown,
    wholesaleRate?: unknown,
  ) {
    const sr = Number(sellingRate);
    const m = Number(mrp);
    const pr = Number(purchaseRate);
    const wr = Number(wholesaleRate);

    if (Number.isFinite(sr) && Number.isFinite(m) && sr > m) {
      throw new BadRequestException(
        `Selling price (${sr}) cannot exceed MRP (${m}).`,
      );
    }
    if (Number.isFinite(pr) && pr > 0 && Number.isFinite(sr) && pr > sr) {
      throw new BadRequestException(
        `Purchase rate (${pr}) cannot exceed selling price (${sr}).`,
      );
    }
    if (Number.isFinite(pr) && pr > 0 && Number.isFinite(m) && pr > m) {
      throw new BadRequestException(
        `Purchase rate (${pr}) cannot exceed MRP (${m}).`,
      );
    }
    if (Number.isFinite(wr) && wr > 0 && Number.isFinite(m) && wr > m) {
      throw new BadRequestException(
        `Wholesale rate (${wr}) cannot exceed MRP (${m}).`,
      );
    }
  }

  // Reject duplicate product name within the same branch (case-insensitive).
  // Two products with identical names break FEFO selection (which one to ship?)
  // and confuse stock reporting. Barcode uniqueness alone isn't enough — many
  // products are entered without barcodes.
  private async assertUniqueName(name: string, branchId?: string, ignoreId?: string) {
    const existing = await this.prisma.product.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        branchId: branchId ?? null,
        ...(ignoreId ? { NOT: { id: ignoreId } } : {}),
      },
    });
    if (existing) {
      throw new ConflictException(
        `Product "${name}" already exists in this branch (id: ${existing.id})`,
      );
    }
  }

  async create(createProductDto: CreateProductDto & { branchId?: string }) {
    const { categoryId, branchId, ...rest } = createProductDto;
    this.assertPricingSane(rest.sellingRate, rest.mrp, rest.purchaseRate, rest.wholesaleRate);
    await this.assertUniqueName(rest.name, branchId);
    return this.prisma.product.create({
      data: { ...rest, categoryId, ...(branchId ? { branchId } : {}) } as unknown as Prisma.ProductUncheckedCreateInput,
    });
  }

  async bulkCreate(products: any[], branchId?: string) {
    let createdCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    const branchScope = branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }];
    
    // 1. Resolve Categories
    const allCategories = await this.prisma.category.findMany({
      where: { OR: branchScope },
      select: { id: true, name: true }
    });
    const categoryByName = new Map(allCategories.map(c => [c.name.toLowerCase().trim(), c.id]));
    
    // 2. Pre-fetch existing products to prevent duplicates
    const existingProducts = await this.prisma.product.findMany({
      where: { OR: branchScope },
      select: { name: true }
    });
    const existingNames = new Set(existingProducts.map(p => p.name.toLowerCase().trim()));

    const toCreate = [];

    // Process rows
    for (const [index, row] of products.entries()) {
      try {
        const name = row.name?.trim();
        if (!name) throw new Error('Missing name');
        
        const lowerName = name.toLowerCase();
        if (existingNames.has(lowerName)) {
           skippedCount++;
           continue; // Gracefully skip duplicates
        }
        
        // Handle dynamic category creation
        let categoryId = row.categoryId;
        if (!categoryId && row.categoryName) {
           const cName = row.categoryName.trim();
           const lowerCName = cName.toLowerCase();
           if (categoryByName.has(lowerCName)) {
              categoryId = categoryByName.get(lowerCName);
           } else {
              // Create category on the fly
              const newCat = await this.prisma.category.create({
                 data: { name: cName, branchId }
              });
              categoryByName.set(lowerCName, newCat.id);
              categoryId = newCat.id;
           }
        }
        
        existingNames.add(lowerName); // prevent duplicates within the same batch
        
        toCreate.push({
            name: row.name,
            genericName: row.genericName || 'Unknown',
            saltComposition: row.saltComposition || undefined,
            manufacturer: row.manufacturer || 'Unknown',
            categoryId,
            subCategory: row.subCategory || undefined,
            packSize: row.packSize || '1',
            unitOfMeasure: row.unitOfMeasure || 'NOS',
            schedule: row.schedule || 'NONE',
            hsnCode: row.hsnCode || '0000',
            isNarcotic: !!row.isNarcotic,
            storageCondition: row.storageCondition || 'ROOM_TEMP',
            mrp: parseFloat(row.mrp) || 0,
            purchaseRate: parseFloat(row.purchaseRate) || 0,
            sellingRate: parseFloat(row.sellingRate) || parseFloat(row.mrp) || 0,
            wholesaleRate: parseFloat(row.wholesaleRate) || parseFloat(row.mrp) || 0,
            gstRate: parseFloat(row.gstRate) || 0,
            minStock: parseInt(row.minStock) || 10,
            maxStock: parseInt(row.maxStock) || 100,
            reorderQty: parseInt(row.reorderQty) || 10,
            rackLocation: row.rackLocation || 'General',
            barcode: row.barcode || undefined,
            branchId: branchId || undefined,
        });

      } catch (err: any) {
        skippedCount++;
        errors.push(`Row ${index + 1} (${row.name || '?'}): ${err.message}`);
      }
    }

    if (toCreate.length > 0) {
      await this.prisma.product.createMany({
        data: toCreate as any,
        skipDuplicates: true,
      });
      createdCount = toCreate.length;
    }

    return { createdCount, skippedCount, errors };
  }

  async bulkUpdateHsn(items: any[], branchId?: string) {
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    const branchScope = branchId ? [{ branchId }, { branchId: null }] : [{ branchId: null }];
    
    // Pre-fetch all products for matching
    const existingProducts = await this.prisma.product.findMany({
      where: { OR: branchScope },
      select: { id: true, name: true }
    });
    
    const productMap = new Map(existingProducts.map(p => [p.name.toLowerCase().trim(), p.id]));
    const updates = [];

    for (const [index, row] of items.entries()) {
      try {
        const name = row.name?.trim();
        if (!name) throw new Error('Missing name');
        
        const lowerName = name.toLowerCase();
        const productId = productMap.get(lowerName);
        
        if (!productId) {
           skippedCount++;
           errors.push(`Row ${index + 1} (${name}): Product not found`);
           continue;
        }

        const hsnCode = String(row.hsnCode || '').trim() || undefined;
        const gstRate = parseFloat(row.gstRate);
        
        if (!hsnCode && isNaN(gstRate)) {
           skippedCount++;
           continue;
        }

        updates.push(
           this.prisma.product.update({
             where: { id: productId },
             data: {
               ...(hsnCode ? { hsnCode } : {}),
               ...(!isNaN(gstRate) ? { gstRate } : {})
             }
           })
        );
        updatedCount++;
      } catch (err: any) {
        skippedCount++;
        errors.push(`Row ${index + 1} (${row.name || '?'}): ${err.message}`);
      }
    }

    if (updates.length > 0) {
      // Chunking transactions to avoid query limits
      const chunkSize = 500;
      for (let i = 0; i < updates.length; i += chunkSize) {
        await this.prisma.$transaction(updates.slice(i, i + chunkSize));
      }
    }

    return { updatedCount, skippedCount, errors };
  }

  async toggleActive(id: string, branchId?: string) {
    const product = await this.findOne(id, branchId);
    return this.prisma.product.update({
      where: { id },
      data: { isActive: !(product as any).isActive } as any,
    });
  }

  // Relevance score for a product against a search query (LOWER = better).
  // A name prefix ("CALPOL" for "ca") beats a mid-word hit (advaCAn) which beats
  // a match on generic/manufacturer/hsn/barcode — so the obvious name match
  // leads instead of whatever sorts first alphabetically. Mirrors the fields
  // matched in findAll's OR filter. Ties fall back to alphabetical.
  private productRelevanceScore(
    p: { name?: string | null; genericName?: string | null; manufacturer?: string | null; hsnCode?: string | null; barcode?: string | null },
    q: string,
  ): number {
    const name = (p.name ?? '').toLowerCase();
    const generic = (p.genericName ?? '').toLowerCase();
    const mfr = (p.manufacturer ?? '').toLowerCase();
    const hsn = (p.hsnCode ?? '').toLowerCase();
    const barcode = (p.barcode ?? '').toLowerCase();
    if (name === q) return 0;             // exact name
    if (name.startsWith(q)) return 1;     // name prefix → "CALPOL" for "ca"
    if (name.includes(q)) return 2;       // name contains → "advaCAn"
    if (generic.startsWith(q)) return 3;
    if (generic.includes(q)) return 4;
    if (mfr.includes(q)) return 5;
    if (hsn.includes(q) || barcode.includes(q)) return 6;
    return 7;
  }

  async findAll(opts: {
    query?: string;
    categoryId?: string;
    schedule?: string;
    skip?: number;
    take?: number;
    branchId?: string;
    includeInactive?: boolean;
    status?: string;
    // Stock-status folder: 'in_stock' | 'low_stock' | 'out_of_stock'. Filters
    // on the denormalised totalStock column so the paginated list matches the
    // headline counts (previously the list was filtered client-side per page,
    // so "In Stock 5" could show only 4 when the 5th sat on a later page).
    stockFilter?: string;
  } = {}) {
    const { query, categoryId, schedule, skip = 0, take, branchId, includeInactive, status, stockFilter } = opts;

    const where: any = {};
    if (status === 'active') where.isActive = true;
    else if (status === 'inactive') where.isActive = false;
    else if (!includeInactive) where.isActive = true;
    if (branchId) where.branchId = branchId;
    if (query) {
      // PREFIX search, not substring: typing "ca" matches products/names that
      // START with "ca" — never every product where "ca" appears mid-word
      // ("adva[ca]n", "amino[ca]re", "…[ca]ps"). Search by the beginning of the
      // brand or generic name (or manufacturer / barcode).
      where.OR = [
        { name: { startsWith: query, mode: 'insensitive' } },
        { genericName: { startsWith: query, mode: 'insensitive' } },
        { manufacturer: { startsWith: query, mode: 'insensitive' } },
        { barcode: { startsWith: query, mode: 'insensitive' } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (schedule) where.schedule = schedule;

    if (stockFilter === 'in_stock') {
      where.totalStock = { gt: 0 };
    } else if (stockFilter === 'out_of_stock') {
      where.totalStock = { lte: 0 };
    } else if (stockFilter === 'low_stock') {
      // low_stock = totalStock > 0 AND totalStock < minStock — a column-to-column
      // comparison Prisma can't express, so resolve the matching ids under the
      // rest of the filters first, then restrict to them.
      const rows = await this.prisma.product.findMany({
        where,
        select: { id: true, totalStock: true, minStock: true },
      });
      const ids = rows
        .filter((p) => p.totalStock > 0 && p.totalStock < p.minStock)
        .map((p) => p.id);
      where.id = { in: ids };
    }

    const include = { batches: true, category: true };

    if (take !== undefined) {
      const safeTake = Math.min(Math.max(0, take), 100);
      const safeSkip = Math.max(0, skip);
      const q = (query ?? '').trim().toLowerCase();

      if (q) {
        // Relevance-ranked search. The DB can only sort alphabetically, which
        // buries the obvious name match (searching "ca" lists "advaCAn" /
        // "aminoCAre" before anything that STARTS with "ca"). Fetch the matching
        // set (capped), rank by relevance, then paginate the ranked list.
        //
        // A single capped-and-alphabetical fetch isn't enough on its own: once
        // more than RANK_CAP rows match `where` (e.g. many products whose
        // generic name/manufacturer/barcode start with the query), the top
        // RANK_CAP by product-name order can exclude every genuine name-prefix
        // match entirely. Fetch that tier in its own dedicated query so it's
        // never crowded out, then merge with the general candidate pool.
        const RANK_CAP = 200;
        const priorityWhere = {
          ...where,
          OR: [
            { name: { equals: q, mode: 'insensitive' as const } },
            { name: { startsWith: q, mode: 'insensitive' as const } },
          ],
        };
        const [priorityMatches, restMatches, total] = await Promise.all([
          this.prisma.product.findMany({ where: priorityWhere, include, orderBy: { name: 'asc' }, take: RANK_CAP }),
          this.prisma.product.findMany({ where, include, orderBy: { name: 'asc' }, take: RANK_CAP }),
          this.prisma.product.count({ where }),
        ]);
        const seen = new Set<string>();
        const pool = [...priorityMatches, ...restMatches].filter((p) => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        });
        const ranked = pool
          .map((p) => ({ p, s: this.productRelevanceScore(p, q) }))
          .sort((a, b) => a.s - b.s || String(a.p.name ?? '').localeCompare(String(b.p.name ?? '')))
          .map((x) => x.p);
        const page = ranked
          .slice(safeSkip, safeSkip + safeTake)
          .map((p) => this.reconcileProductBatches(p));
        return { data: page, total, hasMore: safeSkip + page.length < total };
      }

      const [data, total] = await Promise.all([
        this.prisma.product.findMany({ where, include, skip: safeSkip, take: safeTake, orderBy: { name: 'asc' } }),
        this.prisma.product.count({ where }),
      ]);
      const dataWithReconciled = data.map((p) => this.reconcileProductBatches(p));
      return { data: dataWithReconciled, total, hasMore: safeSkip + data.length < total };
    }

    const allProducts = await this.prisma.product.findMany({ where, include, orderBy: { name: 'asc' } });
    return allProducts.map((p) => this.reconcileProductBatches(p));
  }

  // Bulk export for the Export → edit → Re-import workflow. Mirrors the
  // findAll filter shape but returns the full result set (no pagination) +
  // every category referenced so the workbook is self-contained.
  async exportData(
    branchId?: string,
    filters?: {
      query?: string;
      categoryId?: string;
      schedule?: string;
      status?: string;
      stockFilter?: string;
    },
  ) {
    const where: any = {};
    if (filters?.status === 'active') where.isActive = true;
    else if (filters?.status === 'inactive') where.isActive = false;
    // No status filter → include everything (active + inactive) for a true
    // backup. The list page defaults to active-only, but for export we want
    // the round-trip to cover archived rows too unless explicitly filtered.
    if (branchId) where.branchId = branchId;
    if (filters?.query) {
      where.OR = [
        { name: { contains: filters.query, mode: 'insensitive' } },
        { genericName: { contains: filters.query, mode: 'insensitive' } },
        { manufacturer: { contains: filters.query, mode: 'insensitive' } },
        { hsnCode: { contains: filters.query, mode: 'insensitive' } },
        { barcode: { contains: filters.query, mode: 'insensitive' } },
      ];
    }
    if (filters?.categoryId) where.categoryId = filters.categoryId;
    if (filters?.schedule) where.schedule = filters.schedule;

    // Same stock-tab filter as findAll(), so the export respects the In Stock /
    // Low Stock / Out of Stock tab the operator has selected.
    const stockFilter = filters?.stockFilter;
    if (stockFilter === 'in_stock') {
      where.totalStock = { gt: 0 };
    } else if (stockFilter === 'out_of_stock') {
      where.totalStock = { lte: 0 };
    } else if (stockFilter === 'low_stock') {
      const rows = await this.prisma.product.findMany({
        where,
        select: { id: true, totalStock: true, minStock: true },
      });
      const ids = rows
        .filter((p) => p.totalStock > 0 && p.totalStock < p.minStock)
        .map((p) => p.id);
      where.id = { in: ids };
    }

    const products = await this.prisma.product.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    // Pull every category (not just referenced ones) so the operator can see
    // / edit unused categories too. Branch-scoped + globals.
    const categoryWhere: any = {};
    if (branchId) categoryWhere.OR = [{ branchId }, { branchId: null }];
    const categories = await this.prisma.category.findMany({
      where: categoryWhere,
      orderBy: { name: 'asc' },
    });

    return { products, categories };
  }

  // ── Batches ───────────────────────────────────────────────────
  // Paginated/filtered batch listing. Frontend pages (Expiry Management,
  // Stock Overview, Stock Adjustment) used to derive batches from the master
  // /products call which loaded every product+batch nested. Letting them hit
  // /batches directly with the filters they need keeps the wire small.
  async findBatches(opts: {
    query?: string;
    productId?: string;
    supplierId?: string;
    categoryId?: string;
    expiringWithin?: number;   // days; e.g. 30 / 60 / 90 / 180
    expired?: boolean;
    status?: 'active' | 'expired' | 'out_of_stock' | 'all';
    // Product-stock status (orthogonal to expiry). Resolved to the set of
    // product ids matching the rule, since `totalStock < minStock` can't be
    // expressed as a column-to-column Prisma filter.
    stockStatus?: 'low_stock' | 'healthy';
    // Orthogonal to `status`: just filters out zero-qty batches without
    // touching the expiry constraint. Used by Expiry Management's All
    // Batches / Expired / Expiring Soon folders to hide written-off and
    // disposed batches (they live in their own history folders).
    hasStock?: boolean;
    skip?: number;
    take?: number;
    branchId?: string;
  } = {}) {
    const { query, productId, supplierId, categoryId, expiringWithin, expired, status, stockStatus, hasStock, skip = 0, take, branchId } = opts;

    const where: any = {};
    if (productId) where.productId = productId;
    if (supplierId) where.supplierId = supplierId;
    // Branch + category scope live on the related product.
    const productFilter: any = {};
    if (branchId) productFilter.branchId = branchId;
    if (categoryId) productFilter.categoryId = categoryId;
    if (Object.keys(productFilter).length > 0) where.product = productFilter;

    const now = new Date();

    // Product-stock status: resolve to matching product ids (low_stock /
    // healthy can't be a direct column comparison), then restrict to in-stock,
    // not-near/expired batches so expiry statuses keep precedence.
    if (stockStatus === 'low_stock' || stockStatus === 'healthy') {
      const prods = await this.prisma.product.findMany({
        where: {
          isActive: true,
          ...(branchId ? { branchId } : {}),
          ...(categoryId ? { categoryId } : {}),
        },
        select: { id: true, totalStock: true, minStock: true },
      });
      const ids = prods
        .filter((p) =>
          stockStatus === 'low_stock'
            ? p.totalStock > 0 && p.totalStock < p.minStock
            : p.totalStock > 0 && p.totalStock >= p.minStock,
        )
        .map((p) => p.id);
      where.productId = { in: ids };
      where.quantity = { gt: 0 };
      where.expiryDate = {
        gt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      };
    }

    if (expired === true) {
      where.expiryDate = { lt: now };
    } else if (expiringWithin !== undefined && !Number.isNaN(expiringWithin)) {
      // Batches expiring within N days (inclusive) and NOT yet expired.
      const upper = new Date(now.getTime() + expiringWithin * 24 * 60 * 60 * 1000);
      where.expiryDate = { gte: now, lte: upper };
    }

    if (status === 'active') {
      where.quantity = { gt: 0 };
      where.expiryDate = where.expiryDate ?? { gte: now };
    } else if (status === 'expired') {
      where.expiryDate = { lt: now };
    } else if (status === 'out_of_stock') {
      where.quantity = 0;
    }

    // `hasStock` applies on top of whatever filter `status` set up — it only
    // matters when the caller hasn't already pinned `quantity` via `status`.
    if (hasStock === true && where.quantity === undefined) {
      where.quantity = { gt: 0 };
    }

    if (query) {
      where.OR = [
        { batchNumber: { contains: query, mode: 'insensitive' } },
        { product: { ...(where.product ?? {}), name: { contains: query, mode: 'insensitive' } } },
      ];
    }

    const include = {
      product: { select: { id: true, name: true, genericName: true, packSize: true, minStock: true, totalStock: true, rackLocation: true } },
      supplier: { select: { id: true, name: true, phone: true } },
    };

    const orderBy = { expiryDate: 'asc' as const };

    // When scoped to a single product, enrich each batch with its authoritative
    // stock movements (received / purchase-returned / sold / sales-returned /
    // adjusted) so the product Batches tab can show columns that reconcile with
    // the batch's live quantity. Skipped for the global batch list (would be a
    // needless product-wide scan per page).
    const enrich = async (rawRows: any[]) => {
      const moves = productId
        ? await this.computeBatchMovements(productId, rawRows)
        : null;
      return rawRows.map((b) => {
        const shaped = this.shapeBatchRow(b);
        const m = moves?.get(b.id);
        return m ? { ...shaped, ...m } : shaped;
      });
    };

    if (take !== undefined) {
      const [rows, total] = await Promise.all([
        this.prisma.batch.findMany({ where, include, skip, take, orderBy }),
        this.prisma.batch.count({ where }),
      ]);
      return { data: await enrich(rows), total };
    }

    const rows = await this.prisma.batch.findMany({ where, include, orderBy });
    return enrich(rows);
  }

  // Authoritative per-batch stock movements for one product. Received is exact
  // (via each batch's originating GRN line, `grnItemId`); sold / returns are
  // keyed by batchNumber because imported line items carry an empty batchId —
  // and split evenly across any batches that share a number so totals aren't
  // double-counted. `adjustedQty` is the residual (manual adjustments, write-
  // offs, orphan/direct stock, and any imperfect attribution) computed so every
  // row balances exactly: qty = received − purchaseReturned − sold +
  // salesReturned + adjusted.
  private async computeBatchMovements(
    productId: string,
    batches: {
      id: string;
      batchNumber: string;
      grnItemId: string | null;
      quantity: number;
    }[],
  ) {
    const grnItemIds = batches
      .map((b) => b.grnItemId)
      .filter((x): x is string => !!x);

    const [grnItems, soldRows, salesRetRows, purRetItems] = await Promise.all([
      grnItemIds.length
        ? this.prisma.gRNItem.findMany({
            where: { id: { in: grnItemIds } },
            select: { id: true, receivedQty: true, freeQty: true },
          })
        : Promise.resolve([] as { id: string; receivedQty: number; freeQty: number }[]),
      this.prisma.invoiceItem.groupBy({
        by: ['batchNumber'],
        where: { productId, invoice: { status: { notIn: ['DRAFT', 'CANCELLED'] } } },
        _sum: { quantity: true },
      }),
      this.prisma.creditNoteItem.groupBy({
        by: ['batchNumber'],
        where: { productId, creditNote: { status: 'APPROVED' } },
        _sum: { returnedQty: true },
      }),
      this.prisma.purchaseReturnItem.findMany({
        where: { productId },
        select: {
          batchNumber: true,
          returnedQty: true,
          purchaseReturn: { select: { reason: true } },
        },
      }),
    ]);

    const receivedByGrnItem = new Map(
      grnItems.map((g) => [g.id, (g.receivedQty ?? 0) + (g.freeQty ?? 0)]),
    );
    const soldByNum = new Map<string, number>();
    for (const s of soldRows) soldByNum.set(s.batchNumber, s._sum.quantity ?? 0);
    const salesRetByNum = new Map<string, number>();
    for (const s of salesRetRows) salesRetByNum.set(s.batchNumber, s._sum.returnedQty ?? 0);
    // Short delivery never touched physical stock, so it isn't a real return —
    // mirrors the deduction rule in purchase-returns.service.ts.
    const SHORT = /short.*delivery|short.*supply/i;
    const purRetByNum = new Map<string, number>();
    for (const it of purRetItems) {
      if (SHORT.test(it.purchaseReturn.reason ?? '')) continue;
      purRetByNum.set(
        it.batchNumber,
        (purRetByNum.get(it.batchNumber) ?? 0) + it.returnedQty,
      );
    }

    const batchesPerNum = new Map<string, number>();
    for (const b of batches)
      batchesPerNum.set(b.batchNumber, (batchesPerNum.get(b.batchNumber) ?? 0) + 1);

    const out = new Map<
      string,
      {
        received: number;
        purchaseReturnedQty: number;
        sold: number;
        salesReturnedQty: number;
        adjustedQty: number;
      }
    >();
    for (const b of batches) {
      const n = batchesPerNum.get(b.batchNumber) || 1;
      const received = b.grnItemId ? receivedByGrnItem.get(b.grnItemId) ?? 0 : 0;
      const sold = Math.round((soldByNum.get(b.batchNumber) ?? 0) / n);
      const salesReturnedQty = Math.round((salesRetByNum.get(b.batchNumber) ?? 0) / n);
      const purchaseReturnedQty = Math.round((purRetByNum.get(b.batchNumber) ?? 0) / n);
      const adjustedQty =
        b.quantity - (received - purchaseReturnedQty - sold + salesReturnedQty);
      out.set(b.id, { received, purchaseReturnedQty, sold, salesReturnedQty, adjustedQty });
    }
    return out;
  }

  async findOneBatch(id: string, branchId?: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: {
        product: { select: { id: true, name: true, genericName: true, packSize: true, manufacturer: true, minStock: true, totalStock: true, branchId: true, rackLocation: true } },
        supplier: { select: { id: true, name: true, phone: true, address: true } },
        // The GRN line that received this batch — its parent GRN carries the
        // actual purchase/receipt date + supplier-invoice reference shown on the
        // detail page. Only joined on the single-batch fetch (the list query
        // stays lean → these are null there).
        grnItem: { include: { grn: { select: { date: true, grnNumber: true, supplierInvoiceNo: true, supplierInvoiceDate: true } } } },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    if (branchId && batch.product?.branchId && batch.product.branchId !== branchId) {
      throw new NotFoundException('Batch not found');
    }
    return this.shapeBatchRow(batch);
  }

  // Flattens product/supplier joins onto the batch row so the frontend gets a
  // single object it can render without re-stitching relations.
  private shapeBatchRow(b: any) {
    return {
      id: b.id,
      batchNumber: b.batchNumber,
      productId: b.productId,
      productName: b.product?.name ?? null,
      genericName: b.product?.genericName ?? null,
      packSize: b.product?.packSize ?? null,
      manufacturer: b.product?.manufacturer ?? null,
      minStock: b.product?.minStock ?? null,
      productTotalStock: b.product?.totalStock ?? null,
      rackLocation: b.product?.rackLocation ?? null,
      mfgDate: b.mfgDate,
      expiryDate: b.expiryDate,
      quantity: b.quantity,
      mrp: b.mrp,
      purchaseRate: b.purchaseRate,
      // Sale rate set for this batch at receipt (GRN). Drives the Batches tab's
      // "Selling Price" column instead of falling back to MRP.
      sellingRate: b.sellingRate,
      supplierId: b.supplierId,
      supplierName: b.supplier?.name ?? null,
      supplierPhone: b.supplier?.phone ?? null,
      supplierAddress: b.supplier?.address ?? null,
      createdAt: b.createdAt,
      // Purchase/receipt date from the originating GRN. Null for batches with no
      // GRN link (legacy/manual) — the frontend falls back to createdAt.
      grnDate: b.grnItem?.grn?.date ?? null,
      grnNumber: b.grnItem?.grn?.grnNumber ?? null,
      supplierInvoiceNo: b.grnItem?.grn?.supplierInvoiceNo ?? null,
      supplierInvoiceDate: b.grnItem?.grn?.supplierInvoiceDate ?? null,
    };
  }

  // DISPLAY-ONLY reconciliation. When the denormalized `totalStock` has drifted
  // below the sum of live batch quantities, trim the batch quantities shown in
  // THIS response so the UI's per-batch numbers add up to the header total.
  //
  // This mutates only the in-memory copy being serialized back to the caller —
  // it MUST NOT write to the database. It runs inside GET handlers (findAll /
  // findOne), and the previous version fired un-awaited `batch.update`
  // decrements from here: that permanently destroyed real batch stock on every
  // product read, trimmed the freshest (longest-dated) batch first, never
  // corrected `totalStock` (so it never converged), and double-decremented
  // under concurrent reads. True reconciliation — recomputing `totalStock` from
  // SUM(batch.quantity) — belongs in an explicit transactional job/endpoint,
  // not a read path. See reconcileTotalStock() (TODO) / the stock audit notes.
  private reconcileProductBatches<T extends { totalStock?: number; batches?: any[] }>(product: T): T {
    if (!product || !Array.isArray(product.batches) || product.batches.length === 0) {
      return product;
    }
    const totalBatchQty = product.batches.reduce((sum: number, b: any) => sum + (b.quantity ?? 0), 0);
    const maxAllowed = product.totalStock ?? 0;
    if (totalBatchQty > maxAllowed) {
      let excess = totalBatchQty - maxAllowed;
      const sorted = [...product.batches].sort(
        (a, b) => new Date(b.expiryDate).getTime() - new Date(a.expiryDate).getTime(),
      );
      for (const b of sorted) {
        if (excess <= 0) break;
        const sub = Math.min(b.quantity, excess);
        b.quantity -= sub; // in-memory display trim only — never persisted
        excess -= sub;
      }
    }
    return product;
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
    return this.reconcileProductBatches(product);
  }

  async update(id: string, updateProductDto: UpdateProductDto, branchId?: string) {
    const existing = await this.findOne(id, branchId);
    // Re-check name uniqueness only when the name is actually changing, and
    // scope the check to the product's own branch rather than the requester's:
    // Super Admins editing a branch-scoped product would otherwise look in the
    // wrong scope and trip on unrelated products that happen to share a name.
    if (updateProductDto.name && updateProductDto.name !== existing.name) {
      await this.assertUniqueName(
        updateProductDto.name,
        existing.branchId ?? undefined,
        id,
      );
    }
    // Validate the effective post-update price pair — either field may be
    // absent on a partial update, in which case we fall back to whatever the
    // row already had stored.
    const effectiveSellingRate = updateProductDto.sellingRate ?? existing.sellingRate;
    const effectiveMrp = updateProductDto.mrp ?? existing.mrp;
    const effectivePurchaseRate = updateProductDto.purchaseRate ?? existing.purchaseRate;
    const effectiveWholesaleRate = updateProductDto.wholesaleRate ?? existing.wholesaleRate;
    this.assertPricingSane(
      effectiveSellingRate,
      effectiveMrp,
      effectivePurchaseRate,
      effectiveWholesaleRate,
    );
    return this.prisma.product.update({ where: { id }, data: updateProductDto });
  }

  async remove(id: string, branchId?: string) {
    await this.findOne(id, branchId);
    return this.prisma.product.delete({ where: { id } });
  }

  async importCsv(buffer: Buffer, branchId?: string): Promise<{ created: number; skipped: number; errors: string[]; warnings: string[] }> {
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new BadRequestException('CSV must have a header row and at least one data row');

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
    const required = ['name', 'genericname', 'manufacturer', 'category', 'packsize', 'unitofmeasure',
      'schedule', 'hsncode', 'storagecondition', 'mrp', 'purchaserate', 'sellingrate',
      'wholesalerate', 'gstrate', 'minstock', 'maxstock', 'reorderqty', 'racklocation'];
    const missing = required.filter((r) => !headers.includes(r));
    if (missing.length) throw new BadRequestException(`Missing columns: ${missing.join(', ')}`);

    // Pre-load all categories for name→id lookup
    const allCategories = await this.prisma.category.findMany({ select: { id: true, name: true } });
    const categoryByName = new Map(allCategories.map((c) => [c.name.toLowerCase().trim(), c.id]));

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
        // Skip rows whose name already exists in this branch
        const dupName = await this.prisma.product.findFirst({
          where: {
            name: { equals: row['name'], mode: 'insensitive' },
            branchId: branchId ?? null,
          },
          select: { id: true },
        });
        if (dupName) { skipped++; continue; }

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
          } as any,
        });
        created++;
      } catch (err: any) {
        errors.push(`Row ${rowNum} (${row['name'] || '?'}): ${err.message}`);
      }
    }

    // Note: this legacy importer never sets totalStock (not in its accepted
    // column set), so it can't create the phantom-stock issue the structured
    // JSON import can — new rows always start at the schema default of 0.
    return { created, skipped, errors, warnings: [] };
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

    return this.prisma.$transaction(async (tx) => {
      const adjustmentNo = await this.numbering.nextNumber(
        tx,
        'ADJ',
        product.branchId ?? branchId ?? null,
      );
      await tx.batch.update({ where: { id: batchId }, data: { quantity: dto.adjustedQty } });
      await tx.product.update({ where: { id: productId }, data: { totalStock: { increment: diff } } });
      if (user) {
        await (tx as any).stockAdjustmentLog.create({
          data: {
            adjustmentNo,
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
          },
        });
      }
      return {
        success: true,
        adjustmentNo,
        batchId,
        previousQty: batch.quantity,
        newQty: dto.adjustedQty,
        diff,
        reason: dto.reason,
      };
    });
  }

  async getProductHistory(productId: string, branchId?: string, opts: { skip?: number; take?: number } = {}) {
    const { skip = 0, take = 100 } = opts;

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { batches: true, category: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (branchId && product.branchId && product.branchId !== branchId) {
      throw new NotFoundException('Product not found');
    }

    // A sale only affects stock once its invoice is finalized. DRAFT invoices
    // (e.g. a credit bill parked for admin approval) haven't deducted stock, and
    // CANCELLED ones had their deduction reversed — so both must be excluded or
    // the timeline shows a phantom stock-out for goods that never left. Mirrors
    // the sold-qty filter in computeBatchMovements so the history, the Batches
    // tab and the real stock all agree.
    const SALE_STOCK_FILTER = { status: { notIn: ['DRAFT', 'CANCELLED'] as any } };

    const [totalSalesCount, totalPurchaseCount, totalSalesReturnCount, totalPurchaseReturnCount] = await Promise.all([
      this.prisma.invoiceItem.count({ where: { productId, invoice: SALE_STOCK_FILTER } }),
      this.prisma.gRNItem.count({ where: { productId } }),
      // Only APPROVED credit notes actually restock inventory — PENDING_REVIEW
      // holds goods without restoring stock and REJECTED touches nothing. Match
      // the stock reality (and the reports/ledger queries) so the history never
      // shows phantom "stock back in" rows for un-approved returns.
      (this.prisma as any).creditNoteItem.count({ where: { productId, creditNote: { status: 'APPROVED' } } }),
      (this.prisma as any).purchaseReturnItem.count({ where: { productId } }),
    ]);

    const [salesItems, purchaseItems, salesReturnItems, purchaseReturnItems] = await Promise.all([
      this.prisma.invoiceItem.findMany({
        where: { productId, invoice: SALE_STOCK_FILTER },
        include: {
          invoice: { select: { id: true, invoiceNumber: true, date: true, customerName: true, customerId: true, status: true, customer: { select: { phone: true } } } },
        },
        orderBy: { invoice: { date: 'desc' } },
        skip,
        take,
      }),
      this.prisma.gRNItem.findMany({
        where: { productId },
        include: {
          grn: { select: { id: true, grnNumber: true, date: true, supplierName: true, supplierId: true, status: true, supplier: { select: { phone: true } } } },
        },
        orderBy: { grn: { date: 'desc' } },
        skip,
        take,
      }),
      // Sales returns — stock came BACK IN from customer. Only APPROVED credit
      // notes restock (see note on the count query above), so exclude
      // PENDING_REVIEW / REJECTED to avoid phantom stock-in rows.
      (this.prisma as any).creditNoteItem.findMany({
        where: { productId, creditNote: { status: 'APPROVED' } },
        include: {
          creditNote: { select: { id: true, creditNoteNo: true, date: true, customerName: true, customerId: true, settlementMode: true, reason: true, customer: { select: { phone: true } } } },
        },
        orderBy: { creditNote: { date: 'desc' } },
        skip,
        take,
      }),
      // Purchase returns — stock went BACK OUT to supplier
      (this.prisma as any).purchaseReturnItem.findMany({
        where: { productId },
        include: {
          purchaseReturn: { select: { id: true, debitNoteNo: true, date: true, supplierName: true, supplierId: true, status: true, reason: true, supplier: { select: { phone: true } } } },
        },
        orderBy: { purchaseReturn: { date: 'desc' } },
        skip,
        take,
      }),
    ]);

    const totalSoldQty = salesItems.reduce((sum: number, i: any) => sum + i.quantity, 0);
    const totalPurchasedQty = purchaseItems.reduce((sum: number, i: any) => sum + i.receivedQty, 0);
    const totalSalesValue = salesItems.reduce((sum: number, i: any) => sum + Number(i.amount), 0);
    const totalPurchaseValue = purchaseItems.reduce((sum: number, i: any) => sum + Number(i.purchaseRate) * i.receivedQty, 0);
    const totalSalesReturnQty = salesReturnItems.reduce((sum: number, i: any) => sum + i.returnedQty, 0);
    // Short-delivery debit notes are financial-only (goods never arrived), so
    // they don't represent a return of physical stock. Exclude them from this
    // count so the "returned to supplier" stat reflects real movements.
    const SHORT_DELIVERY_RE = /short.*delivery|short.*supply/i;
    const totalPurchaseReturnQty = purchaseReturnItems.reduce(
      (sum: number, i: any) =>
        SHORT_DELIVERY_RE.test(i.purchaseReturn?.reason ?? '')
          ? sum
          : sum + i.returnedQty,
      0,
    );
    const activeBatches = product.batches.filter((b) => b.quantity > 0).length;

    return {
      product: {
        id: product.id,
        name: product.name,
        genericName: product.genericName,
        manufacturer: product.manufacturer,
        category: product.category,
        packSize: product.packSize,
        minStock: product.minStock,
        reorderQty: product.reorderQty,
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
      sales: salesItems.map((i: any) => ({
        id: i.id,
        invoiceId: i.invoice.id,
        invoiceNumber: i.invoice.invoiceNumber,
        date: i.invoice.date,
        customerName: i.invoice.customerName,
        customerId: i.invoice.customerId,
        customerPhone: i.invoice.customer?.phone ?? null,
        status: i.invoice.status,
        batchNumber: i.batchNumber,
        quantity: i.quantity,
        rate: Number(i.rate),
        amount: Number(i.amount),
        gstPercent: Number(i.gstPercent),
        discountPercent: Number(i.discountPercent),
      })),
      purchases: purchaseItems.map((i: any) => ({
        id: i.id,
        grnId: i.grn.id,
        grnNumber: i.grn.grnNumber,
        date: i.grn.date,
        supplierName: i.grn.supplierName,
        supplierId: i.grn.supplierId,
        supplierPhone: i.grn.supplier?.phone ?? null,
        status: i.grn.status,
        batchNumber: i.batchNumber,
        receivedQty: i.receivedQty,
        freeQty: i.freeQty,
        purchaseRate: Number(i.purchaseRate),
        mrp: Number(i.mrp),
        amount: Number(i.purchaseRate) * i.receivedQty,
      })),
      // Stock came back IN — customer returned goods
      salesReturns: salesReturnItems.map((i: any) => ({
        id: i.id,
        creditNoteId: i.creditNote.id,
        creditNoteNo: i.creditNote.creditNoteNo,
        date: i.creditNote.date,
        customerName: i.creditNote.customerName,
        customerId: i.creditNote.customerId,
        customerPhone: i.creditNote.customer?.phone ?? null,
        settlementMode: i.creditNote.settlementMode,
        reason: i.creditNote.reason,
        batchNumber: i.batchNumber,
        returnedQty: i.returnedQty,
        rate: Number(i.rate),
        amount: Number(i.amount),
        gstPercent: Number(i.gstPercent),
      })),
      // Stock went back OUT — returned to supplier
      purchaseReturns: purchaseReturnItems.map((i: any) => ({
        id: i.id,
        purchaseReturnId: i.purchaseReturn.id,
        debitNoteNo: i.purchaseReturn.debitNoteNo,
        date: i.purchaseReturn.date,
        supplierName: i.purchaseReturn.supplierName,
        supplierId: i.purchaseReturn.supplierId,
        supplierPhone: i.purchaseReturn.supplier?.phone ?? null,
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

  async bulkAdjustStock(
    items: { productId: string; batchId: string; adjustedQty: number; reason: string; notes?: string }[],
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
        return {
          ...item,
          previousQty: batch.quantity,
          diff: item.adjustedQty - batch.quantity,
          branchId: product.branchId,
          batchNumber: batch.batchNumber,
        };
      }),
    );

    return this.prisma.$transaction(async (tx) => {
      const adjustmentNo = await this.numbering.nextNumber(
        tx,
        'ADJ',
        branchId ?? null,
      );
      for (const item of resolved) {
        await tx.batch.update({
          where: { id: item.batchId },
          data: { quantity: item.adjustedQty },
        });
        if (user) {
          await (tx as any).stockAdjustmentLog.create({
            data: {
              adjustmentNo,
              productId: item.productId,
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              userId: user.userId,
              userName: user.name,
              reason: item.reason,
              previousQty: item.previousQty,
              adjustedQty: item.adjustedQty,
              diff: item.diff,
              notes: item.notes ?? null,
              branchId: item.branchId ?? branchId ?? null,
            },
          });
        }
      }
      // Reconcile each affected product's denormalized totalStock from the
      // ACTUAL sum of its batch quantities, inside this transaction. Replaces
      // the old `totalStock: { increment: staleDiff }` where diff was computed
      // from a pre-transaction read — racy against a concurrent sale, and able
      // to drift or go negative. SUM of the live (non-negative) batch rows is
      // always correct and can't go below 0. (H2 + M1 fix.)
      const affectedProductIds = Array.from(new Set(resolved.map((i) => i.productId)));
      for (const pid of affectedProductIds) {
        const agg = await tx.batch.aggregate({
          where: { productId: pid },
          _sum: { quantity: true },
        });
        await tx.product.update({
          where: { id: pid },
          data: { totalStock: agg._sum.quantity ?? 0 },
        });
      }
      return {
        success: true,
        adjustmentNo,
        adjusted: resolved.length,
        items: resolved.map(({ productId, batchId, previousQty, adjustedQty, diff, reason }) => ({
          productId,
          batchId,
          previousQty,
          newQty: adjustedQty,
          diff,
          reason,
        })),
      };
    });
  }

  // Estimate the rupee-value impact of an adjustment so the controller can
  // decide whether to queue an approval. Uses batch.purchaseRate (COST) as the
  // per-unit value — the financial impact of writing stock off is what we PAID
  // for it, not its MRP; valuing at MRP overstates the loss and wrongly trips
  // the approval threshold. (M4 fix.)
  // Skips lines whose batch can't be found — those will throw at execute time.
  async estimateAdjustmentValue(
    items: { productId: string; batchId: string; adjustedQty: number }[],
    branchId?: string,
  ): Promise<number> {
    let total = 0;
    for (const item of items) {
      const batch = await this.prisma.batch.findFirst({
        where: { id: item.batchId, productId: item.productId },
      });
      if (!batch) continue;
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
        select: { branchId: true },
      });
      if (branchId && product?.branchId && product.branchId !== branchId) continue;
      const diff = Math.abs(item.adjustedQty - batch.quantity);
      total += diff * Number(batch.purchaseRate);
    }
    return total;
  }

  // Paginated list of historical stock adjustments, grouped by `adjustmentNo`
  // (one submission = many log rows sharing one number). Returns one entry per
  // submission with line items embedded so the frontend can render a detail
  // panel without a second fetch.
  //
  // Impact in rupees is best-effort: the per-unit COST (batch.purchaseRate) is
  // read from the *current* batch (the log doesn't snapshot it). When a batch
  // has been deleted, cost falls back to 0 — so totalImpact is an approximation,
  // not an authoritative ledger value. Cost (not MRP) is used so a write-off's
  // impact reflects what was paid for the stock. (M4 fix.)
  async listAdjustments(
    branchId: string | undefined,
    opts: { skip?: number; take?: number } = {},
  ) {
    const skip = opts.skip ?? 0;
    const take = Math.min(opts.take ?? 10, 50);
    const where = {
      branchId: branchId ?? undefined,
      adjustmentNo: { not: null },
    } as const;

    // 1. Distinct adjustmentNos for the current page, newest first.
    const grouped = await (this.prisma as any).stockAdjustmentLog.groupBy({
      by: ['adjustmentNo'],
      where,
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      skip,
      take,
    });
    const totalGrouped = await (this.prisma as any).stockAdjustmentLog.groupBy({
      by: ['adjustmentNo'],
      where,
      _count: { _all: true },
    });
    const total = totalGrouped.length;

    if (grouped.length === 0) return { data: [], total };

    const adjustmentNos: string[] = grouped.map((g: any) => g.adjustmentNo);

    // 2. All log rows for those adjustmentNos, with product name joined.
    const logs = await (this.prisma as any).stockAdjustmentLog.findMany({
      where: { ...where, adjustmentNo: { in: adjustmentNos } },
      include: { product: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // 3. Best-effort per-batch lookup: mrp for the display column, purchaseRate
    // (cost) for the financial impact. Impact is cost-based (M4).
    const batchIds = Array.from(new Set(logs.map((l: any) => l.batchId)));
    const batches = batchIds.length
      ? await this.prisma.batch.findMany({
          where: { id: { in: batchIds as string[] } },
          select: { id: true, mrp: true, purchaseRate: true },
        })
      : [];
    const mrpByBatch = new Map(batches.map((b) => [b.id, Number(b.mrp)]));
    const costByBatch = new Map(batches.map((b) => [b.id, Number(b.purchaseRate)]));

    // 4. Group logs by adjustmentNo, preserving the page order.
    const byNo = new Map<string, any[]>();
    for (const log of logs) {
      const list = byNo.get(log.adjustmentNo) ?? [];
      list.push(log);
      byNo.set(log.adjustmentNo, list);
    }

    const data = adjustmentNos.map((no) => {
      const items = (byNo.get(no) ?? []).map((l: any) => {
        const mrp = mrpByBatch.get(l.batchId) ?? 0;
        const cost = costByBatch.get(l.batchId) ?? 0;
        const impact = l.diff * cost;
        return {
          productId: l.productId,
          productName: l.product?.name ?? '(deleted product)',
          batchId: l.batchId,
          batchNumber: l.batchNumber,
          reason: l.reason,
          previousQty: l.previousQty,
          adjustedQty: l.adjustedQty,
          diff: l.diff,
          notes: l.notes,
          mrp,
          impact,
        };
      });
      const first = (byNo.get(no) ?? [])[0];
      const totalDiff = items.reduce((s, i) => s + i.diff, 0);
      const totalImpact = items.reduce((s, i) => s + i.impact, 0);
      return {
        adjustmentNo: no,
        createdAt: first?.createdAt,
        userId: first?.userId,
        userName: first?.userName,
        branchId: first?.branchId,
        itemsCount: items.length,
        totalDiff,
        totalImpact,
        items,
      };
    });

    return { data, total };
  }

  // Flat list of disposal/write-off log rows for a single reason, used by the
  // Expiry Management page's "Write-offs" and "Disposals" folders. Unlike
  // `listAdjustments` (grouped by adjustmentNo), this returns one row per
  // affected batch since the caller wants a batch-centric view.
  async listDisposals(
    branchId: string | undefined,
    reason: 'Expired Removal' | 'Damaged',
    opts: { skip?: number; take?: number } = {},
  ) {
    const skip = opts.skip ?? 0;
    const take = Math.min(opts.take ?? 10, 50);
    const where = { branchId: branchId ?? undefined, reason };
    const [rows, total] = await Promise.all([
      (this.prisma as any).stockAdjustmentLog.findMany({
        where,
        include: { product: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      (this.prisma as any).stockAdjustmentLog.count({ where }),
    ]);
    return {
      data: rows.map((l: any) => ({
        id: l.id,
        adjustmentNo: l.adjustmentNo,
        productId: l.productId,
        productName: l.product?.name ?? '(deleted product)',
        batchId: l.batchId,
        batchNumber: l.batchNumber,
        reason: l.reason,
        previousQty: l.previousQty,
        adjustedQty: l.adjustedQty,
        diff: l.diff,
        notes: l.notes,
        userId: l.userId,
        userName: l.userName,
        createdAt: l.createdAt,
      })),
      total,
    };
  }

  // Decide whether to execute the adjustment immediately or queue it for admin
  // approval based on rupee value and user role. Admins always execute.
  async submitBulkAdjustment(
    items: { productId: string; batchId: string; adjustedQty: number; reason: string; notes?: string }[],
    branchId: string | undefined,
    user: { userId: string; name: string; role: string },
  ) {
    const totalValue = await this.estimateAdjustmentValue(items, branchId);
    const threshold = Number(
      process.env.MAX_ADJUSTMENT_VALUE_NO_APPROVAL ?? DEFAULT_ADJUSTMENT_APPROVAL_THRESHOLD,
    );

    if (!isAdminRole(user.role) && totalValue > threshold) {
      // Enrich each line with product name, batch number and the current qty so
      // the approver sees full human-readable detail (Product · Batch · Current
      // → New · Δ) instead of bare ids.
      const adjBatches = await this.prisma.batch.findMany({
        where: { id: { in: items.map((i) => i.batchId) } },
        select: {
          id: true,
          batchNumber: true,
          quantity: true,
          product: { select: { name: true } },
        },
      });
      const adjBatchById = new Map(adjBatches.map((b) => [b.id, b]));
      const enrichedItems = items.map((it) => {
        const b = adjBatchById.get(it.batchId);
        return {
          ...it,
          productName: b?.product?.name ?? null,
          batchNumber: b?.batchNumber ?? null,
          previousQty: b?.quantity ?? null,
        };
      });
      const req = await this.approvalsService.createRequest({
        type: 'INVENTORY_ADJUSTMENT' as any,
        payload: { items: enrichedItems, requestedByName: user.name },
        requestedById: user.userId,
        branchId,
      });
      return {
        approvalRequested: true,
        approvalRequestId: req.id,
        totalValue,
        threshold,
      };
    }

    return this.bulkAdjustStock(items, branchId, user);
  }
}
