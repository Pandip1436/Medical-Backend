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
// The slice of an existing Product the import needs to decide create-vs-update
// and to describe the match back to the operator.
type ExistingProductMatch = {
  id: string;
  name: string;
  barcode: string | null;
  productCode: string | null;
  branchId: string | null;
};

const DEFAULT_GENERIC_NAME = 'Unknown';
const DEFAULT_MANUFACTURER = 'Unknown';
const DEFAULT_PACK_SIZE = '1';
const DEFAULT_UNIT = 'NOS';
const DEFAULT_HSN = '';
const DEFAULT_RACK = 'GENERAL';

/**
 * Which blank text fields are worth a warning. Everything not listed takes its
 * default silently.
 *
 * A warning has to mean "this will mis-bill, or hide the product from a
 * filter". Warning on every defaulted field produced 3,285 warnings on a
 * 2,723-row catalogue, which is the same as producing none — nobody reads
 * 3,285 lines, so the handful that mattered were buried.
 *
 * Deliberately NOT warned (chosen by the user, 14 Aug 2026): generic_name,
 * manufacturer, pack_size, unit_of_measure, rack_location. Each has a safe
 * default and is editable from the product form at any time. rack_location in
 * particular has no MARG equivalent, so it is blank on every imported row.
 */
const WARN_ON_MISSING_TEXT: Array<{
  column: string;
  get: (r: ImportProductDto) => string | undefined;
}> = [
  { column: 'salt_composition', get: (r) => r.saltComposition },
  { column: 'hsn_code', get: (r) => r.hsnCode },
  // Not a stubbed default: a row with no category simply links to none, so the
  // product never shows under any category filter.
  { column: 'category_name', get: (r) => r.categoryName },
];

/** Price fields whose absence is worth a warning. See WARN_ON_MISSING_TEXT. */
const WARN_ON_MISSING_PRICE = {
  sellingRate: true,
  mrp: true,
  gstRate: true,
  purchaseRate: true,
  // Blank wholesale_rate bills every wholesale line at cost. The user chose to
  // silence it on 14 Aug 2026 after being shown that it affects all 2,723 rows;
  // flip this to true to bring the warning back.
  wholesaleRate: false,
} as const;

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
    const productCodeKeys = Array.from(
      new Set(
        validRows
          .map((p) => p.productCode?.trim())
          .filter((c): c is string => !!c),
      ),
    );
    const existing = await this.findExisting(
      nameKeys,
      barcodeKeys,
      productCodeKeys,
      ctx.branchId,
    );
    const existingByName = new Map<string, ExistingProductMatch>();
    const existingByBarcode = new Map<string, ExistingProductMatch>();
    const existingByCode = new Map<string, ExistingProductMatch>();
    for (const e of existing) {
      existingByName.set(nameKey(e.name), e);
      if (e.barcode) existingByBarcode.set(e.barcode.trim(), e);
      if (e.productCode) existingByCode.set(e.productCode.trim(), e);
    }

    const crossBranchByName = await this.findCrossBranchDuplicates(
      nameKeys,
      ctx.branchId,
    );

    const previewClaimed = new Set<string>();
    for (const p of validRows) {
      const match = this.resolveExisting(
        p,
        existingByName,
        existingByBarcode,
        existingByCode,
        previewClaimed,
      );
      if (!match) continue;
      previewClaimed.add(match.id);
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
        existingByCode,
        crossBranchByName,
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
    // The real, freshly-resolved category ids for THIS db/branch. An explicit
    // category_id carried in an exported file is stale (categories get new ids
    // on import), so we only honour it when it matches one of these.
    const validCategoryIds = new Set(categoryByName.values());

    // Products already adopted by an earlier row, so a later row can't take
    // the same one (see resolveExisting).
    const claimed = new Set<string>();
    for (const row of validRows) {
      await this.processRow(
        row,
        existingByName,
        existingByBarcode,
        existingByCode,
        claimed,
        categoryByName,
        validCategoryIds,
        crossBranchByName,
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
    const seenIdentities = new Map<string, number>();
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

      // Two rows are the same product only when BOTH the name and the product
      // code match. Real catalogues repeat a name under different codes (the
      // same drug under two company groupings) and, less often, repeat a code
      // under different names — those are distinct products and both import.
      // Keying on the code alone failed the second row outright; keying on the
      // name alone collapsed two products into one.
      const code = (row.productCode ?? '').trim();
      const identity = code ? `${nameKey(name)}\u0000${code}` : nameKey(name);
      const firstSeen = seenIdentities.get(identity);
      if (firstSeen !== undefined) {
        this.pushWarning(result, {
          kind: 'duplicate',
          sheet: 'Products',
          row: src,
          productCode: row.productCode,
          field: code ? 'product_code' : 'name',
          message: code
            ? `Same name and item code "${code}" as row ${firstSeen} — the same product listed twice, so only the first row is imported.`
            : `Same product name appears earlier in this file at row ${firstSeen}, and neither row has an item code to tell them apart. Only the first row will be imported — give them distinct codes to import both.`,
        });
        result.summary.products.skipped++;
        continue;
      }
      seenIdentities.set(identity, src);

      // Barcodes are unique per branch in the database, so a repeat cannot be
      // kept — but the product itself is perfectly importable. Drop just the
      // barcode and let the row through rather than failing the whole product.
      const barcode = (row.barcode ?? '').trim();
      if (barcode) {
        const firstBarcode = seenBarcodes.get(barcode);
        if (firstBarcode !== undefined) {
          row.barcode = undefined;
          this.pushWarning(result, {
            kind: 'coerced',
            sheet: 'Products',
            row: src,
            productCode: row.productCode,
            field: 'barcode',
            message: `Barcode "${barcode}" is already used at row ${firstBarcode}. Imported this product without a barcode — add a unique one on the product form.`,
          });
        } else {
          seenBarcodes.set(barcode, src);
        }
      }

      valid.push(row);
    }
    return valid;
  }

  /**
   * Decide which existing product (if any) an import row refers to.
   *
   * A row is the same product as an existing one when its NAME and its item
   * CODE both match — the code alone is not enough, because the same code can
   * legitimately sit on a differently named product and this row must not
   * overwrite it. When that pair doesn't resolve we fall back to name/barcode,
   * but only onto a product that is safe to adopt, which is what makes the
   * first import of a coded file over an existing un-coded catalogue back-fill
   * codes instead of creating 374 duplicates. Two guards keep that honest:
   *
   *  - `claimed` stops a second row adopting a product an earlier row already
   *    took. Without it, two rows sharing a name (different codes) would both
   *    resolve to the same product and the second would overwrite the first's
   *    code, quietly collapsing two products into one.
   *  - a candidate that already carries a DIFFERENT code is not ours; the row
   *    describes a genuinely new product that happens to share a name.
   */
  private resolveExisting(
    row: ImportProductDto,
    existingByName: Map<string, ExistingProductMatch>,
    existingByBarcode: Map<string, ExistingProductMatch>,
    existingByCode: Map<string, ExistingProductMatch>,
    claimed: Set<string>,
  ): ExistingProductMatch | undefined {
    const code = row.productCode?.trim();
    if (code) {
      const hit = existingByCode.get(code);
      // The code on its own is not proof of identity: a duplicate is a row
      // whose name AND code both match. A code resolving to a differently
      // named product belongs to that other product, and this row must not
      // silently overwrite it.
      if (hit && nameKey(hit.name) === nameKey(row.name)) return hit;
    }
    const candidate =
      existingByName.get(nameKey(row.name)) ??
      (row.barcode ? existingByBarcode.get(row.barcode.trim()) : undefined);
    if (!candidate) return undefined;
    if (claimed.has(candidate.id)) return undefined;
    if (code && candidate.productCode && candidate.productCode !== code) {
      return undefined;
    }
    return candidate;
  }

  // ── Phase 2: existing-product lookup ──────────────────────────────────────
  private async findExisting(
    nameKeys: string[],
    barcodeKeys: string[],
    productCodeKeys: string[],
    branchId?: string | null,
  ) {
    if (!nameKeys.length && !barcodeKeys.length && !productCodeKeys.length)
      return [] as Array<{
        id: string;
        name: string;
        barcode: string | null;
        productCode: string | null;
        branchId: string | null;
      }>;

    // AND of (any name OR barcode OR product code matches) AND (branch is
    // this-branch or null). Same explicit-AND pattern as customer/supplier
    // imports — spreading two top-level OR keys would silently drop one.
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
    if (productCodeKeys.length) {
      matchConditions.push({ productCode: { in: productCodeKeys } });
    }

    const where: Prisma.ProductWhereInput = {
      AND: [
        { OR: matchConditions },
        ...(branchId ? [{ OR: [{ branchId }, { branchId: null }] }] : []),
      ],
    };
    return this.prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        barcode: true,
        productCode: true,
        branchId: true,
      },
    });
  }

  // Same-named products that exist in OTHER branches (not the import's target
  // branch, not global). Purely informational — never blocks or redirects the
  // import — used to warn when a row would create a phantom-stock duplicate:
  // a fresh product row with totalStock copied in but zero real batches,
  // because the branch legitimately needs its own Product+Batch rows (Batch
  // has no branchId of its own — scoping flows through Product.branchId).
  private async findCrossBranchDuplicates(
    nameKeys: string[],
    branchId?: string | null,
  ): Promise<Map<string, { branchName: string }>> {
    const out = new Map<string, { branchName: string }>();
    if (!nameKeys.length || !branchId) return out;

    const rows = await this.prisma.product.findMany({
      where: {
        AND: [
          {
            OR: nameKeys.map((n) => ({
              name: { equals: n, mode: 'insensitive' as const },
            })),
          },
          { NOT: [{ branchId }, { branchId: null }] },
        ],
      },
      select: { name: true, branch: { select: { name: true } } },
    });
    for (const r of rows) {
      const key = nameKey(r.name);
      if (!out.has(key)) {
        out.set(key, { branchName: r.branch?.name ?? 'another branch' });
      }
    }
    return out;
  }

  // ── Phase 3a: dry-run simulation ──────────────────────────────────────────
  private simulate(
    rows: ImportProductDto[],
    existingByName: Map<string, ExistingProductMatch>,
    existingByBarcode: Map<string, ExistingProductMatch>,
    existingByCode: Map<string, ExistingProductMatch>,
    crossBranchByName: Map<string, { branchName: string }>,
    handling: ImportDuplicateHandling,
    result: ImportResult,
  ) {
    // Track categories referenced by name so the preview banner can show
    // how many new categories will be auto-created. We use a Set for the
    // category-name accumulation; the actual create happens at commit.
    const newCategoryNames = new Set<string>();
    const claimed = new Set<string>();

    for (const row of rows) {
      const hit = this.resolveExisting(
        row,
        existingByName,
        existingByBarcode,
        existingByCode,
        claimed,
      );
      if (hit) claimed.add(hit.id);
      // Accumulate BEFORE the skip/refuse branches below: resolveAllCategories()
      // runs over every valid row at commit, so a category referenced only by
      // rows this strategy skips still gets created. Counting it after the
      // `continue`s made the preview under-report new categories.
      const catName = row.categoryName?.trim();
      if (catName) newCategoryNames.add(catName.toLowerCase());

      const isDup = !!hit;
      if (isDup) {
        if (handling === 'SKIP') {
          result.summary.products.skipped++;
          continue;
        }
        if (handling === 'UPDATE' || handling === 'UPDATE_ONLY') {
          result.summary.products.updated++;
        }
        // CREATE refuses a row that matches an existing product — processRow()
        // pushes an error and counts it failed. The preview used to count it
        // created, so the review screen promised a new product the commit was
        // always going to reject.
        if (handling === 'CREATE') {
          this.pushError(result, {
            sheet: 'Products',
            row: row.sourceRow ?? 0,
            productCode: row.productCode,
            field: 'name',
            message: `CREATE strategy refused: a product named "${hit.name}" already exists. Choose UPDATE or SKIP instead.`,
          });
          result.summary.products.failed++;
          continue;
        }
      } else {
        // UPDATE_ONLY never creates — rows with no existing match are skipped.
        if (handling === 'UPDATE_ONLY') {
          result.summary.products.skipped++;
          continue;
        }
        result.summary.products.created++;
      }

      // Only the fields in WARN_ON_MISSING_TEXT are worth interrupting for.
      const missing = WARN_ON_MISSING_TEXT.filter(
        (f) => !f.get(row)?.trim(),
      ).map((f) => f.column);
      if (missing.length) {
        this.pushWarning(result, {
          kind: 'coerced',
          sheet: 'Products',
          row: row.sourceRow ?? 0,
          productCode: row.productCode,
          message: `Missing values for ${missing.join(', ')} — safe defaults will be applied (clean up via the product form post-import).`,
        });
      }
      // Pricing gets its own, louder warning — unlike the cosmetic defaults
      // above, a wrong price bills a real customer. The message has to say
      // what will ACTUALLY happen: the previous copy claimed a missing price
      // imports "priced at ₹0", which is false for the common case and hid
      // the expensive one. buildCreateData() falls back sellingRate → mrp → 0,
      // so a row with an MRP and no selling rate bills at full MRP, not at a
      // trade rate — and nothing on the invoice reveals it. Only when both are
      // blank does it bill at zero.
      // Every remaining duplicate here is an UPDATE (SKIP and CREATE both
      // `continue`d above), so a match means update and no match means create.
      const willCreate = !isDup;
      const money = (n: number) => `₹${n.toFixed(2)}`;
      const pricingNotes: string[] = [];
      if (willCreate) {
        // The rates the product will actually be billed at, per buildCreateData:
        // sellingRate → mrp → 0, and wholesaleRate → purchaseRate → 0. Judging
        // the row on what it *supplies* rather than on what it will *charge* is
        // how a mis-price stays invisible.
        const retail = row.sellingRate ?? row.mrp ?? 0;
        const wholesale = row.wholesaleRate ?? row.purchaseRate ?? 0;
        const cost = row.purchaseRate;

        if (WARN_ON_MISSING_PRICE.sellingRate) {
          if (row.sellingRate === undefined) {
            pricingNotes.push(
              row.mrp === undefined
                ? 'no selling_rate and no mrp — retail sales will bill at ₹0'
                : `no selling_rate — retail sales will bill at the MRP (${money(row.mrp)}), not at a trade rate`,
            );
          } else if (row.sellingRate === 0) {
            // A deliberate 0 reads as "supplied" to every `?? ` fallback, so it
            // silently becomes a real ₹0 price rather than being defaulted.
            pricingNotes.push('selling_rate is 0 — retail sales will bill at ₹0');
          }
        }
        // wholesaleRate falls back to the PURCHASE rate, so a blank one prices
        // every wholesale line at exactly cost — zero margin, and below the
        // threshold of nothing, so no other guard in the app catches it.
        if (WARN_ON_MISSING_PRICE.wholesaleRate) {
          if (row.wholesaleRate === undefined) {
            pricingNotes.push(
              row.purchaseRate === undefined
                ? 'no wholesale_rate and no purchase_rate — wholesale sales will bill at ₹0'
                : `no wholesale_rate — wholesale sales will bill at cost (${money(row.purchaseRate)}), earning nothing`,
            );
          } else if (row.wholesaleRate === 0) {
            pricingNotes.push(
              'wholesale_rate is 0 — wholesale sales will bill at ₹0',
            );
          }
        }
        // Below cost is judged on the EFFECTIVE rate, so a row that inherits an
        // MRP lower than its purchase rate is caught too.
        if (cost !== undefined && retail > 0 && retail < cost) {
          pricingNotes.push(
            `retail rate ${money(retail)} is below purchase_rate ${money(cost)} — every retail sale loses money`,
          );
        }
        if (cost !== undefined && wholesale > 0 && wholesale < cost) {
          pricingNotes.push(
            `wholesale rate ${money(wholesale)} is below purchase_rate ${money(cost)} — every wholesale sale loses money`,
          );
        }
        if (WARN_ON_MISSING_PRICE.mrp && row.mrp === undefined)
          pricingNotes.push('no mrp — stored as ₹0');
        if (WARN_ON_MISSING_PRICE.purchaseRate && row.purchaseRate === undefined)
          pricingNotes.push(
            'no purchase_rate — stored as ₹0, so margin and below-cost checks cannot work for this product',
          );
        if (WARN_ON_MISSING_PRICE.gstRate && row.gstRate === undefined)
          pricingNotes.push('no gst_rate — stored as 0%, so invoices carry no tax');
      } else {
        // On UPDATE a blank price leaves the stored price untouched, so only a
        // price the file actually supplies can be judged here.
        if (row.sellingRate === 0)
          pricingNotes.push('selling_rate is 0 — retail sales will bill at ₹0');
        if (row.wholesaleRate === 0)
          pricingNotes.push('wholesale_rate is 0 — wholesale sales will bill at ₹0');
        if (row.purchaseRate !== undefined) {
          if (row.sellingRate !== undefined && row.sellingRate < row.purchaseRate)
            pricingNotes.push(
              `selling_rate ${money(row.sellingRate)} is below purchase_rate ${money(row.purchaseRate)} — every retail sale loses money`,
            );
          if (
            row.wholesaleRate !== undefined &&
            row.wholesaleRate < row.purchaseRate
          )
            pricingNotes.push(
              `wholesale_rate ${money(row.wholesaleRate)} is below purchase_rate ${money(row.purchaseRate)} — every wholesale sale loses money`,
            );
        }
      }
      if (pricingNotes.length) {
        this.pushWarning(result, {
          kind: 'coerced',
          sheet: 'Products',
          row: row.sourceRow ?? 0,
          productCode: row.productCode,
          message: `Pricing: ${pricingNotes.join('; ')}. Fix these before the product is sold.`,
        });
      }
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
    existingByName: Map<string, ExistingProductMatch>,
    existingByBarcode: Map<string, ExistingProductMatch>,
    existingByCode: Map<string, ExistingProductMatch>,
    claimed: Set<string>,
    categoryByName: Map<string, string>,
    validCategoryIds: Set<string>,
    crossBranchByName: Map<string, { branchName: string }>,
    handling: ImportDuplicateHandling,
    ctx: { userId: string; branchId?: string | null },
    result: ImportResult,
  ): Promise<void> {
    // Same resolution as the dry-run preview, so what the review screen
    // promised is what the commit actually does.
    const existing = this.resolveExisting(
      row,
      existingByName,
      existingByBarcode,
      existingByCode,
      claimed,
    );
    if (existing) claimed.add(existing.id);

    // Resolve categoryId. Prefer the name→id map (always a real id for this
    // db/branch). Only fall back to an explicit category_id when it actually
    // exists — a stale id from an exported file would otherwise fail the
    // `category: { connect }` with "No Category record found".
    const rawId = row.categoryId?.trim();
    const categoryId =
      categoryByName.get((row.categoryName ?? '').trim().toLowerCase()) ??
      (rawId && validCategoryIds.has(rawId) ? rawId : null);

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
      // UPDATE. Same item-code guard as the create path below: buildUpdateData
      // writes any supplied code, and codes are unique per branch, so stamping
      // one that another product already holds fails the whole update and the
      // row's other corrections (prices, HSN, pack size) are lost with it.
      // Keep the row, drop the contested code.
      const updCode = row.productCode?.trim();
      const updCodeHolder = updCode ? existingByCode.get(updCode) : undefined;
      if (updCode && updCodeHolder && updCodeHolder.id !== existing.id) {
        this.pushWarning(result, {
          kind: 'coerced',
          sheet: 'Products',
          row: row.sourceRow ?? 0,
          productCode: updCode,
          field: 'product_code',
          message: `Item code "${updCode}" already belongs to "${updCodeHolder.name}" in this branch. Updated "${existing.name}" without changing its code — give one of them a unique code on the product form.`,
        });
        row.productCode = undefined;
      }
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
        // A code this row just assigned is now taken — register it so a later
        // row in the same file collides against the guard above instead of
        // against the database constraint.
        if (typeof updateData.productCode === 'string') {
          existingByCode.set(updateData.productCode.trim(), {
            ...existing,
            productCode: updateData.productCode,
          });
        }
        result.summary.products.updated++;
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

    // No existing match. UPDATE_ONLY tops up existing products only — skip.
    if (handling === 'UPDATE_ONLY') {
      result.summary.products.skipped++;
      return;
    }

    // No existing match — create. Item codes are unique per branch in the
    // database, so a code already held by a differently-named product (which
    // resolveExisting deliberately does not treat as a match) would fail the
    // constraint. Import the product without the code rather than dropping it.
    const newCode = row.productCode?.trim();
    const codeHolder = newCode ? existingByCode.get(newCode) : undefined;
    if (newCode && codeHolder) {
      this.pushWarning(result, {
        kind: 'coerced',
        sheet: 'Products',
        row: row.sourceRow ?? 0,
        productCode: newCode,
        field: 'product_code',
        message: `Item code "${newCode}" already belongs to "${codeHolder.name}" in this branch. Imported "${row.name}" without a code — give it a unique one on the product form.`,
      });
      row.productCode = undefined;
    }

    try {
      const created = await this.prisma.product.create({
        data: this.buildCreateData(row, categoryId, ctx.branchId ?? null),
        select: {
          id: true,
          name: true,
          barcode: true,
          productCode: true,
          branchId: true,
        },
      });
      // Register the new code so a later row in the same file that carries it
      // sees it as taken rather than hitting the constraint mid-import.
      if (created.productCode) {
        existingByCode.set(created.productCode.trim(), created);
      }
      result.summary.products.created++;
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
      productCode: row.productCode?.trim() || null,
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
      totalStock: 0,
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
    // Fills in the code on a product that didn't have one, so a name-matched
    // row picks up its code the first time a coded file is imported. Blank in
    // the file means "not supplied" and leaves any existing code alone —
    // clearing a code has to be done from the product form.
    if (row.productCode?.trim()) data.productCode = row.productCode.trim();
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
    if (h === 'UPDATE' || h === 'UPDATE_ONLY') return 'will-update';
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
