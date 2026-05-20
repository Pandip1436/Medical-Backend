import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, Schedule, StorageCondition } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ImportCategoryDto,
  ImportDuplicateHandling,
  ImportDuplicateMatch,
  ImportProductDto,
  ImportProductsDto,
  ImportResult,
  ImportRowError,
  ImportRowWarning,
  ImportSummary,
} from './dto/import-products.dto';

// Trim + lowercase name for in-memory dedup. Branch-scoped uniqueness on
// `name` is enforced at the service layer (not the DB), so we have to be
// careful to apply the same comparison rule the live product creation uses.
function nameKey(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

function emptyResult(dryRun: boolean): ImportResult {
  return {
    dryRun,
    summary: emptySummary(),
    duplicates: [],
    errors: [],
    warnings: [],
  };
}

function emptySummary(): ImportSummary {
  return {
    products: { created: 0, updated: 0, skipped: 0, failed: 0 },
    categories: { created: 0, reused: 0 },
    openingStockApplied: 0,
  };
}

// ── Defaults applied to sparse rows ───────────────────────────────────────
// Prisma requires these columns at the DB level, but legacy migrations often
// only have name + price columns. We default the rest and emit warnings so
// the operator can fix them later via the product form.
const DEFAULT_GENERIC_NAME = 'Unknown';
const DEFAULT_MANUFACTURER = 'Unknown';
const DEFAULT_PACK_SIZE = '1';
const DEFAULT_UNIT = 'NOS';
const DEFAULT_HSN = '';
const DEFAULT_RACK = 'GENERAL';

@Injectable()
export class ProductImportService {
  constructor(private readonly prisma: PrismaService) {}

  // Single entry point for /preview and /commit. Same diagnostic shape
  // either way — the drawer renders the same panel.
  async runImport(
    dto: ImportProductsDto,
    ctx: { userId: string; branchId?: string | null },
  ): Promise<ImportResult> {
    void ctx.userId; // reserved for future audit logging
    if (!dto?.products?.length) {
      throw new BadRequestException(
        'No products provided in the import payload.',
      );
    }

    const dryRun = !!dto.dryRun;
    const result: ImportResult = emptyResult(dryRun);

    // ── Phase 1: in-payload validation ──
    const validRows = this.validatePayload(dto.products, result);
    if (validRows.length === 0) return result;

    // ── Phase 2: resolve existing products by name + barcode ──
    // Two batched queries — names (case-insensitive contains) and barcodes.
    const nameKeys = Array.from(
      new Set(validRows.map((p) => nameKey(p.name)).filter(Boolean)),
    );
    const barcodeKeys = Array.from(
      new Set(
        validRows.map((p) => p.barcode?.trim()).filter((b): b is string => !!b),
      ),
    );
    const existing = await this.findExisting(
      nameKeys,
      barcodeKeys,
      ctx.branchId,
    );
    const existingByName = new Map<
      string,
      {
        id: string;
        name: string;
        barcode: string | null;
        branchId: string | null;
      }
    >();
    const existingByBarcode = new Map<
      string,
      {
        id: string;
        name: string;
        barcode: string | null;
        branchId: string | null;
      }
    >();
    for (const e of existing) {
      existingByName.set(nameKey(e.name), e);
      if (e.barcode) existingByBarcode.set(e.barcode.trim(), e);
    }

    for (const p of validRows) {
      const byName = existingByName.get(nameKey(p.name));
      const byBarcode = p.barcode
        ? existingByBarcode.get(p.barcode.trim())
        : undefined;
      const match = byName ?? byBarcode;
      if (!match) continue;
      result.duplicates.push({
        productCode: p.productCode,
        sourceRow: p.sourceRow ?? 0,
        action: this.actionForHandling(dto.duplicateHandling),
        existingProduct: {
          id: match.id,
          name: match.name,
          barcode: match.barcode,
        },
      });
    }

    if (dryRun) {
      this.simulate(
        validRows,
        existingByName,
        existingByBarcode,
        dto.duplicateHandling,
        result,
      );
      return result;
    }

    // ── Phase 3: real import ──
    // Pre-resolve all referenced categories ONCE (lookup-or-create), then
    // process each product. Mini-tx per product to keep one bad row from
    // poisoning the rest (Postgres aborted-tx rule).
    const categoryByName = await this.resolveAllCategories(
      dto.categories ?? [],
      validRows,
      ctx.branchId ?? null,
      result,
    );

    for (const row of validRows) {
      await this.processRow(
        row,
        existingByName,
        existingByBarcode,
        categoryByName,
        dto.duplicateHandling,
        ctx,
        result,
      );
    }
    return result;
  }

  // ── Phase 1: payload validation ───────────────────────────────────────────
  private validatePayload(
    rows: ImportProductDto[],
    result: ImportResult,
  ): ImportProductDto[] {
    const seenNames = new Map<string, number>();
    const seenCodes = new Map<string, number>();
    const seenBarcodes = new Map<string, number>();
    const valid: ImportProductDto[] = [];

    for (const row of rows) {
      const src = row.sourceRow ?? 0;
      const name = (row.name ?? '').trim();
      if (!name) {
        this.pushError(result, {
          sheet: 'Products',
          row: src,
          productCode: row.productCode,
          field: 'name',
          message: 'Name is required.',
        });
        result.summary.products.failed++;
        continue;
      }

      const key = nameKey(name);
      if (seenNames.has(key)) {
        this.pushWarning(result, {
          kind: 'duplicate',
          sheet: 'Products',
          row: src,
          productCode: row.productCode,
          field: 'name',
          message: `Same product name appears earlier in this file at row ${seenNames.get(key)}. Only the first row will be imported.`,
        });
        result.summary.products.skipped++;
        continue;
      }
      seenNames.set(key, src);

      const code = (row.productCode ?? '').trim();
      if (code) {
        if (seenCodes.has(code)) {
          this.pushError(result, {
            sheet: 'Products',
            row: src,
            productCode: code,
            field: 'product_code',
            message: `Duplicate product_code "${code}" — already used at row ${seenCodes.get(code)}.`,
          });
          result.summary.products.failed++;
          continue;
        }
        seenCodes.set(code, src);
      }

      const barcode = (row.barcode ?? '').trim();
      if (barcode) {
        if (seenBarcodes.has(barcode)) {
          this.pushError(result, {
            sheet: 'Products',
            row: src,
            productCode: row.productCode,
            field: 'barcode',
            message: `Duplicate barcode "${barcode}" — already used at row ${seenBarcodes.get(barcode)}.`,
          });
          result.summary.products.failed++;
          continue;
        }
        seenBarcodes.set(barcode, src);
      }

      valid.push(row);
    }
    return valid;
  }

  // ── Phase 2: existing-product lookup ──────────────────────────────────────
  private async findExisting(
    nameKeys: string[],
    barcodeKeys: string[],
    branchId?: string | null,
  ) {
    if (!nameKeys.length && !barcodeKeys.length)
      return [] as Array<{
        id: string;
        name: string;
        barcode: string | null;
        branchId: string | null;
      }>;

    // AND of (any name OR any barcode matches) AND (branch is this-branch
    // or null). Same explicit-AND pattern as customer/supplier imports —
    // spreading two top-level OR keys would silently drop one.
    const matchConditions: Prisma.ProductWhereInput[] = [];
    if (nameKeys.length) {
      matchConditions.push({
        OR: nameKeys.map((n) => ({
          name: { equals: n, mode: 'insensitive' as const },
        })),
      });
    }
    if (barcodeKeys.length) {
      matchConditions.push({ barcode: { in: barcodeKeys } });
    }

    const where: Prisma.ProductWhereInput = {
      AND: [
        { OR: matchConditions },
        ...(branchId ? [{ OR: [{ branchId }, { branchId: null }] }] : []),
      ],
    };
    return this.prisma.product.findMany({
      where,
      select: { id: true, name: true, barcode: true, branchId: true },
    });
  }

  // ── Phase 3a: dry-run simulation ──────────────────────────────────────────
  private simulate(
    rows: ImportProductDto[],
    existingByName: Map<
      string,
      { id: string; name: string; barcode: string | null }
    >,
    existingByBarcode: Map<
      string,
      { id: string; name: string; barcode: string | null }
    >,
    handling: ImportDuplicateHandling,
    result: ImportResult,
  ) {
    // Track categories referenced by name so the preview banner can show
    // how many new categories will be auto-created. We use a Set for the
    // category-name accumulation; the actual create happens at commit.
    const newCategoryNames = new Set<string>();

    for (const row of rows) {
      const isDup =
        existingByName.has(nameKey(row.name)) ||
        (row.barcode ? existingByBarcode.has(row.barcode.trim()) : false);
      if (isDup) {
        if (handling === 'SKIP') {
          result.summary.products.skipped++;
          continue;
        }
        if (handling === 'UPDATE') result.summary.products.updated++;
        if (handling === 'CREATE') result.summary.products.created++;
      } else {
        result.summary.products.created++;
      }
      if (typeof row.totalStock === 'number' && row.totalStock > 0) {
        result.summary.openingStockApplied += row.totalStock;
      }

      // Warnings for defaulted required fields, so operator sees what'll
      // get stubbed out before committing.
      const missing: string[] = [];
      if (!row.genericName?.trim()) missing.push('generic_name');
      if (!row.manufacturer?.trim()) missing.push('manufacturer');
      if (!row.packSize?.trim()) missing.push('pack_size');
      if (!row.unitOfMeasure?.trim()) missing.push('unit_of_measure');
      if (!row.hsnCode?.trim()) missing.push('hsn_code');
      if (!row.rackLocation?.trim()) missing.push('rack_location');
      if (missing.length) {
        this.pushWarning(result, {
          kind: 'coerced',
          sheet: 'Products',
          row: row.sourceRow ?? 0,
          productCode: row.productCode,
          message: `Missing values for ${missing.join(', ')} — safe defaults will be applied (clean up via the product form post-import).`,
        });
      }
      if (typeof row.totalStock === 'number' && row.totalStock > 0) {
        this.pushWarning(result, {
          kind: 'coerced',
          sheet: 'Products',
          row: row.sourceRow ?? 0,
          productCode: row.productCode,
          field: 'total_stock',
          message:
            "total_stock is a denormalised field — the canonical source of stock is Batches (created via GRN). The imported number will be visible immediately but won't match batch quantities until you load actual GRNs.",
        });
      }
      const catName = row.categoryName?.trim();
      if (catName) newCategoryNames.add(catName.toLowerCase());
    }
    // We can't know how many of these already exist without a DB query, but
    // the preview is meant to be cheap. Report the total referenced names —
    // the post-commit numbers will distinguish created vs reused.
    result.summary.categories.created = newCategoryNames.size;
  }

  // ── Category resolution (lookup-or-create) ───────────────────────────────
  // Reads every category referenced by the workbook + the Categories sheet,
  // looks them up in one batched query, and creates missing ones. Returns
  // a `name(lowercased) → id` map used by processRow().
  //
  // Why pre-resolve: the live product form requires categoryId; mapping
  // by name needs a real DB id. Doing it once up-front means each product
  // create is a simple connect — no per-row category lookup.
  private async resolveAllCategories(
    sheetCategories: ImportCategoryDto[],
    products: ImportProductDto[],
    branchId: string | null,
    result: ImportResult,
  ): Promise<Map<string, string>> {
    const wanted = new Map<string, ImportCategoryDto | null>();
    for (const c of sheetCategories) {
      const k = (c.name ?? '').trim().toLowerCase();
      if (!k) continue;
      wanted.set(k, c);
    }
    for (const p of products) {
      const k = (p.categoryName ?? '').trim().toLowerCase();
      if (!k) continue;
      if (!wanted.has(k)) wanted.set(k, null); // referenced-only, no sheet row
    }

    const out = new Map<string, string>();
    if (wanted.size === 0) return out;

    // Batched lookup against the branch (plus null-branch globals).
    const names = Array.from(wanted.keys());
    const existing = await this.prisma.category.findMany({
      where: {
        AND: [
          {
            OR: names.map((n) => ({
              name: { equals: n, mode: 'insensitive' as const },
            })),
          },
          ...(branchId ? [{ OR: [{ branchId }, { branchId: null }] }] : []),
        ],
      },
      select: { id: true, name: true },
    });
    for (const c of existing) {
      out.set(c.name.toLowerCase(), c.id);
      result.summary.categories.reused++;
    }

    // Create the missing ones. Use a single mini-tx per category to keep
    // failures localized.
    for (const [key, sheetRow] of wanted.entries()) {
      if (out.has(key)) continue;
      try {
        const display = sheetRow?.name ?? key; // preserve original casing if from sheet
        const created = await this.prisma.category.create({
          data: {
            name: display.trim(),
            description: sheetRow?.description?.trim() || null,
            color: sheetRow?.color?.trim() || null,
            isActive: sheetRow?.isActive ?? true,
            ...(branchId ? { branch: { connect: { id: branchId } } } : {}),
          },
          select: { id: true },
        });
        out.set(key, created.id);
        result.summary.categories.created++;
      } catch (err) {
        this.pushError(result, {
          sheet: 'Categories',
          row: sheetRow?.sourceRow ?? 0,
          field: 'name',
          message: this.errMsg(err, `Failed to create category "${key}"`),
        });
      }
    }
    return out;
  }

  // ── Phase 3b: real import ─────────────────────────────────────────────────
  private async processRow(
    row: ImportProductDto,
    existingByName: Map<
      string,
      {
        id: string;
        name: string;
        barcode: string | null;
        branchId: string | null;
      }
    >,
    existingByBarcode: Map<
      string,
      {
        id: string;
        name: string;
        barcode: string | null;
        branchId: string | null;
      }
    >,
    categoryByName: Map<string, string>,
    handling: ImportDuplicateHandling,
    ctx: { userId: string; branchId?: string | null },
    result: ImportResult,
  ): Promise<void> {
    const existing =
      existingByName.get(nameKey(row.name)) ??
      (row.barcode ? existingByBarcode.get(row.barcode.trim()) : undefined);

    // Resolve categoryId: explicit id wins over name lookup.
    const categoryId =
      row.categoryId?.trim() ||
      categoryByName.get((row.categoryName ?? '').trim().toLowerCase()) ||
      null;

    if (existing) {
      if (handling === 'SKIP') {
        result.summary.products.skipped++;
        return;
      }
      if (handling === 'CREATE') {
        this.pushError(result, {
          sheet: 'Products',
          row: row.sourceRow ?? 0,
          productCode: row.productCode,
          field: 'name',
          message: `CREATE strategy refused: a product named "${existing.name}" already exists. Choose UPDATE or SKIP instead.`,
        });
        result.summary.products.failed++;
        return;
      }
      // UPDATE
      try {
        const updateData = this.buildUpdateData(row, categoryId);
        if (existing.branchId === null && ctx.branchId) {
          updateData.branch = { connect: { id: ctx.branchId } };
          this.pushWarning(result, {
            kind: 'coerced',
            sheet: 'Products',
            row: row.sourceRow ?? 0,
            productCode: row.productCode,
            field: 'branchId',
            message:
              "Existing product had no branch — claiming it to your active branch so it shows in this branch's list.",
          });
        }
        await this.prisma.product.update({
          where: { id: existing.id },
          data: updateData,
        });
        result.summary.products.updated++;
        if (typeof row.totalStock === 'number' && row.totalStock > 0) {
          result.summary.openingStockApplied += row.totalStock;
        }
      } catch (err) {
        this.pushError(result, {
          sheet: 'Products',
          row: row.sourceRow ?? 0,
          productCode: row.productCode,
          message: this.errMsg(err, 'Failed to update existing product'),
        });
        result.summary.products.failed++;
      }
      return;
    }

    // No existing match — create.
    try {
      await this.prisma.product.create({
        data: this.buildCreateData(row, categoryId, ctx.branchId ?? null),
      });
      result.summary.products.created++;
      if (typeof row.totalStock === 'number' && row.totalStock > 0) {
        result.summary.openingStockApplied += row.totalStock;
      }
    } catch (err) {
      // P2002 here means barcode collision with a different branch's row
      // (we already filtered same-branch above). Surface a clear error.
      this.pushError(result, {
        sheet: 'Products',
        row: row.sourceRow ?? 0,
        productCode: row.productCode,
        message: this.errMsg(err, 'Failed to create product'),
      });
      result.summary.products.failed++;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildCreateData(
    row: ImportProductDto,
    categoryId: string | null,
    branchId: string | null,
  ): Prisma.ProductCreateInput {
    return {
      name: row.name.trim(),
      genericName: row.genericName?.trim() || DEFAULT_GENERIC_NAME,
      saltComposition: row.saltComposition?.trim() || null,
      manufacturer: row.manufacturer?.trim() || DEFAULT_MANUFACTURER,
      ...(categoryId ? { category: { connect: { id: categoryId } } } : {}),
      subCategory: row.subCategory?.trim() || null,
      packSize: row.packSize?.trim() || DEFAULT_PACK_SIZE,
      unitOfMeasure: row.unitOfMeasure?.trim() || DEFAULT_UNIT,
      schedule: row.schedule ?? Schedule.NONE,
      hsnCode: row.hsnCode?.trim() || DEFAULT_HSN,
      isNarcotic: row.isNarcotic ?? false,
      storageCondition: row.storageCondition ?? StorageCondition.ROOM_TEMP,
      mrp: new Prisma.Decimal(row.mrp ?? 0),
      purchaseRate: new Prisma.Decimal(row.purchaseRate ?? 0),
      sellingRate: new Prisma.Decimal(row.sellingRate ?? row.mrp ?? 0),
      wholesaleRate: new Prisma.Decimal(
        row.wholesaleRate ?? row.purchaseRate ?? 0,
      ),
      gstRate: new Prisma.Decimal(row.gstRate ?? 0),
      minStock: row.minStock ?? 0,
      maxStock: row.maxStock ?? 0,
      reorderQty: row.reorderQty ?? 0,
      rackLocation: row.rackLocation?.trim() || DEFAULT_RACK,
      barcode: row.barcode?.trim() || null,
      totalStock: row.totalStock ?? 0,
      isActive: row.isActive ?? true,
      ...(branchId ? { branch: { connect: { id: branchId } } } : {}),
    };
  }

  // UPDATE rewrites only fields the user explicitly provided. We never touch
  // `name` (the match key) or `totalStock` (which can drift from real batch
  // quantities — we don't want to silently overwrite reconciled stock).
  private buildUpdateData(
    row: ImportProductDto,
    categoryId: string | null,
  ): Prisma.ProductUpdateInput {
    const data: Prisma.ProductUpdateInput = {};
    if (row.genericName !== undefined)
      data.genericName = row.genericName?.trim() || DEFAULT_GENERIC_NAME;
    if (row.saltComposition !== undefined)
      data.saltComposition = row.saltComposition?.trim() || null;
    if (row.manufacturer !== undefined)
      data.manufacturer = row.manufacturer?.trim() || DEFAULT_MANUFACTURER;
    if (categoryId) data.category = { connect: { id: categoryId } };
    if (row.subCategory !== undefined)
      data.subCategory = row.subCategory?.trim() || null;
    if (row.packSize !== undefined)
      data.packSize = row.packSize?.trim() || DEFAULT_PACK_SIZE;
    if (row.unitOfMeasure !== undefined)
      data.unitOfMeasure = row.unitOfMeasure?.trim() || DEFAULT_UNIT;
    if (row.schedule !== undefined) data.schedule = row.schedule;
    if (row.hsnCode !== undefined)
      data.hsnCode = row.hsnCode?.trim() || DEFAULT_HSN;
    if (row.isNarcotic !== undefined) data.isNarcotic = row.isNarcotic;
    if (row.storageCondition !== undefined)
      data.storageCondition = row.storageCondition;
    if (row.mrp !== undefined) data.mrp = new Prisma.Decimal(row.mrp);
    if (row.purchaseRate !== undefined)
      data.purchaseRate = new Prisma.Decimal(row.purchaseRate);
    if (row.sellingRate !== undefined)
      data.sellingRate = new Prisma.Decimal(row.sellingRate);
    if (row.wholesaleRate !== undefined)
      data.wholesaleRate = new Prisma.Decimal(row.wholesaleRate);
    if (row.gstRate !== undefined)
      data.gstRate = new Prisma.Decimal(row.gstRate);
    if (row.minStock !== undefined) data.minStock = row.minStock;
    if (row.maxStock !== undefined) data.maxStock = row.maxStock;
    if (row.reorderQty !== undefined) data.reorderQty = row.reorderQty;
    if (row.rackLocation !== undefined)
      data.rackLocation = row.rackLocation?.trim() || DEFAULT_RACK;
    if (row.barcode !== undefined) data.barcode = row.barcode?.trim() || null;
    if (row.isActive !== undefined) data.isActive = row.isActive;
    return data;
  }

  private actionForHandling(
    h: ImportDuplicateHandling,
  ): ImportDuplicateMatch['action'] {
    if (h === 'UPDATE') return 'will-update';
    if (h === 'SKIP') return 'will-skip';
    return 'will-create-new';
  }

  private pushError(result: ImportResult, err: ImportRowError) {
    result.errors.push(err);
  }
  private pushWarning(result: ImportResult, warn: ImportRowWarning) {
    result.warnings.push(warn);
  }

  private errMsg(err: unknown, fallback: string): string {
    const e = err as { code?: string; message?: string };
    if (e?.code === 'P2002') {
      return `${fallback}: a record with the same unique field already exists (likely a duplicate barcode in this branch).`;
    }
    return e?.message ? `${fallback}: ${e.message}` : fallback;
  }
}
