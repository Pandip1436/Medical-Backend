import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Schedule, StorageCondition } from '@prisma/client';

// Mirror of customer/supplier import DTOs. Products are flat (no history
// sub-entities — batches come from GRN, alternatives are managed via the
// product form), so we just need a Products sheet + an optional Categories
// pre-create sheet.
//
// Duplicate-handling key for products: `name` (case-insensitive, branch-
// scoped) is the primary match. `barcode` is also @@unique([barcode,branchId])
// so it acts as a secondary match — if the user provides a barcode that
// already exists in the same branch, we treat that as a duplicate too.
export type ImportDuplicateHandling =
  | 'UPDATE'
  | 'SKIP'
  | 'CREATE'
  // Update matching products only; skip (don't create) rows with no match.
  // Used to top-up existing products from partial files (e.g. an HSN/GST master).
  | 'UPDATE_ONLY';

// ── Optional Categories pre-create sheet ──────────────────────────────────
// Lets the operator define category names + descriptions up-front. Products
// referencing these by name will auto-link. If a product references a
// category that isn't on this sheet OR pre-existing in the DB, the service
// auto-creates a stub category by name (with empty description) — same
// behaviour as the existing bulkCreate path.
export class ImportCategoryDto {
  @IsOptional() @IsInt() sourceRow?: number;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── Product row ───────────────────────────────────────────────────────────
// All Prisma-required fields are OPTIONAL in the import DTO so legacy
// migrations with sparse data aren't blocked. The service applies safe
// defaults (Unknown / NOS / NONE / ROOM_TEMP / GENERAL) at write time and
// emits a warning per defaulted field so the operator can clean up later
// via the product form.
export class ImportProductDto {
  @IsOptional() @IsInt() sourceRow?: number;

  // Operator-local reference. Not persisted — kept on the row so errors
  // can echo it back.
  @IsOptional() @IsString() productCode?: string;

  @IsString() name!: string;

  @IsOptional() @IsString() genericName?: string;
  @IsOptional() @IsString() saltComposition?: string;
  @IsOptional() @IsString() manufacturer?: string;
  // Either category_id (direct FK) OR category_name (looked up / auto-created).
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() categoryName?: string;
  @IsOptional() @IsString() subCategory?: string;
  @IsOptional() @IsString() packSize?: string;
  @IsOptional() @IsString() unitOfMeasure?: string;
  @IsOptional() @IsEnum(Schedule) schedule?: Schedule;
  @IsOptional() @IsString() hsnCode?: string;
  @IsOptional() @IsBoolean() isNarcotic?: boolean;
  @IsOptional() @IsEnum(StorageCondition) storageCondition?: StorageCondition;

  // Decimal money fields. We accept plain numbers from Excel; service
  // converts to Prisma.Decimal at write time.
  @IsOptional() @IsNumber() mrp?: number;
  @IsOptional() @IsNumber() purchaseRate?: number;
  @IsOptional() @IsNumber() sellingRate?: number;
  @IsOptional() @IsNumber() wholesaleRate?: number;
  @IsOptional() @IsNumber() gstRate?: number;

  @IsOptional() @IsInt() @Min(0) minStock?: number;
  @IsOptional() @IsInt() @Min(0) maxStock?: number;
  @IsOptional() @IsInt() @Min(0) reorderQty?: number;

  @IsOptional() @IsString() rackLocation?: string;
  @IsOptional() @IsString() barcode?: string;

  // Optional opening stock. The canonical source of stock is Batch rows
  // (created via GRN), so we write `totalStock` verbatim but emit a warning
  // that it's denormalised — the operator should load real batches via the
  // supplier import or GRN flow for the numbers to stay accurate over time.
  @IsOptional() @IsInt() @Min(0) totalStock?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ImportProductsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportCategoryDto)
  categories?: ImportCategoryDto[];

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ImportProductDto)
  products!: ImportProductDto[];

  @IsIn(['UPDATE', 'SKIP', 'CREATE', 'UPDATE_ONLY'])
  duplicateHandling!: ImportDuplicateHandling;

  @IsOptional() @IsBoolean() dryRun?: boolean;
}

// ─── Result shapes ─────────────────────────────────────────────────────────

export interface ImportRowError {
  sheet: 'Products' | 'Categories';
  row: number;
  productCode?: string;
  field?: string;
  message: string;
}

export interface ImportRowWarning extends ImportRowError {
  kind: 'duplicate' | 'missing-link' | 'coerced';
}

export interface ImportDuplicateMatch {
  productCode?: string;
  sourceRow: number;
  action: 'will-update' | 'will-skip' | 'will-create-new';
  existingProduct: {
    id: string;
    name: string;
    barcode: string | null;
  };
}

export interface ImportSummary {
  products: {
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  categories: { created: number; reused: number };
  openingStockApplied: number;
}

export interface ImportResult {
  dryRun: boolean;
  summary: ImportSummary;
  duplicates: ImportDuplicateMatch[];
  errors: ImportRowError[];
  warnings: ImportRowWarning[];
}
