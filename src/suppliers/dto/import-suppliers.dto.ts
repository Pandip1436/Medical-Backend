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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  PaymentTerms,
  POStatus,
  GRNStatus,
  PurchaseReturnStatus,
  PurchaseReturnSettlement,
  SupplierActivityStatus,
  SupplierActivityType,
} from '@prisma/client';

// Mirrors the customer-import DTO model: one workbook row → one supplier +
// nested PO/GRN/DN/Activity collections. The frontend parses the multi-sheet
// workbook into this shape; the backend stays Excel-agnostic.
//
// Note vs customer side: there is NO supplier-payment model (the supplier
// "ledger" is computed from GRN debits + PurchaseReturn ADJUST credits). So
// no payments sheet here — historical payments are absorbed by the supplier's
// `opening_balance` written to Supplier.currentOutstanding verbatim.
export type ImportDuplicateHandling = 'UPDATE' | 'SKIP' | 'CREATE';

// ── Purchase Order ────────────────────────────────────────────────────────
export class ImportPurchaseOrderItemDto {
  @IsOptional() @IsString() productName?: string;
  @IsOptional() @IsNumber() requiredQty?: number;
  @IsOptional() @IsNumber() lastPurchaseRate?: number;
  @IsOptional() @IsNumber() expectedRate?: number;
  @IsOptional() @IsNumber() receivedQty?: number;
  @IsOptional() @IsString() remarks?: string;
}

export class ImportPurchaseOrderDto {
  @IsOptional() @IsInt() sourceRow?: number;
  // Optional user-provided PO number. If absent, service generates one via
  // DocumentNumberingService at commit time.
  @IsOptional() @IsString() poNumber?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() expectedDelivery?: string;
  @IsOptional() @IsNumber() totalAmount?: number;
  @IsOptional() @IsEnum(POStatus) status?: POStatus;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportPurchaseOrderItemDto)
  items?: ImportPurchaseOrderItemDto[];
}

// ── GRN (Goods Received Note) ─────────────────────────────────────────────
export class ImportGrnItemDto {
  @IsOptional() @IsString() productName?: string;
  @IsOptional() @IsNumber() orderedQty?: number;
  @IsOptional() @IsNumber() receivedQty?: number;
  @IsOptional() @IsNumber() freeQty?: number;
  @IsOptional() @IsString() batchNumber?: string;
  @IsOptional() @IsString() mfgDate?: string;
  @IsOptional() @IsString() expiryDate?: string;
  @IsOptional() @IsNumber() purchaseRate?: number;
  @IsOptional() @IsNumber() mrp?: number;
  @IsOptional() @IsNumber() damageQty?: number;
}

export class ImportGrnDto {
  @IsOptional() @IsInt() sourceRow?: number;
  // Optional user-provided GRN number. Auto-generated if blank.
  @IsOptional() @IsString() grnNumber?: string;
  @IsOptional() @IsString() date?: string;
  // Supplier's own invoice number for this delivery — required at DB level.
  @IsString() supplierInvoiceNo!: string;
  @IsOptional() @IsString() supplierInvoiceDate?: string;
  @IsOptional() @IsNumber() supplierInvoiceAmount?: number;
  @IsOptional() @IsNumber() totalAmount?: number;
  @IsOptional() @IsEnum(GRNStatus) status?: GRNStatus;
  @IsOptional() @IsBoolean() isReplacement?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportGrnItemDto)
  items?: ImportGrnItemDto[];
}

// ── Debit Note (a.k.a. PurchaseReturn) ────────────────────────────────────
// A debit note is always against an existing GRN. We resolve grnId by
// looking up the parent GRN by (supplierId, grnNumber) — same pattern as
// customer credit-notes resolving the parent invoice.
export class ImportDebitNoteItemDto {
  @IsOptional() @IsString() productName?: string;
  @IsOptional() @IsString() batchNumber?: string;
  @IsOptional() @IsString() expiryDate?: string;
  @IsOptional() @IsNumber() returnedQty?: number;
  @IsOptional() @IsNumber() purchaseRate?: number;
  @IsOptional() @IsNumber() gstPercent?: number;
  @IsOptional() @IsNumber() amount?: number;
}

export class ImportDebitNoteDto {
  @IsOptional() @IsInt() sourceRow?: number;
  @IsOptional() @IsString() debitNoteNo?: string;
  @IsOptional() @IsString() grnNumber?: string; // optional parent GRN
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsNumber() subtotal?: number;
  @IsOptional() @IsNumber() cgst?: number;
  @IsOptional() @IsNumber() sgst?: number;
  @IsOptional() @IsNumber() igst?: number;
  @IsOptional() @IsNumber() totalAmount?: number;
  @IsOptional() @IsEnum(PurchaseReturnStatus) status?: PurchaseReturnStatus;
  @IsOptional()
  @IsEnum(PurchaseReturnSettlement)
  settlementMode?: PurchaseReturnSettlement;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportDebitNoteItemDto)
  items?: ImportDebitNoteItemDto[];
}

// ── Batch ─────────────────────────────────────────────────────────────────
// A Batch is a stock-batch row tied to a Product + Supplier. Unlike the
// other supplier-history entities, Batch requires a REAL Product.id (FK).
// The service resolves Product by `productName` (case-insensitive, scoped to
// active branch). If `productId` is explicitly provided we use it directly;
// otherwise we look up by name and fail-fast if there's no exact match.
export class ImportBatchDto {
  @IsOptional() @IsInt() sourceRow?: number;
  // Either provide productId directly (preferred for accuracy) OR productName
  // (looked up). productName is convenient for non-technical operators.
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() productName?: string;
  @IsString() batchNumber!: string;
  @IsOptional() @IsString() mfgDate?: string;
  @IsOptional() @IsString() expiryDate?: string;
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsNumber() mrp?: number;
  @IsOptional() @IsNumber() purchaseRate?: number;
}

// ── Activity ──────────────────────────────────────────────────────────────
export class ImportSupplierActivityDto {
  @IsOptional() @IsInt() sourceRow?: number;
  @IsEnum(SupplierActivityType) type!: SupplierActivityType;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() occurredAt?: string;
  @IsOptional() @IsString() dueAt?: string;
  @IsOptional() @IsEnum(SupplierActivityStatus) status?: SupplierActivityStatus;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() subject?: string;
}

// ── Supplier ──────────────────────────────────────────────────────────────
// Supplier base fields are REQUIRED in the Prisma schema (contactPerson, gstin,
// drugLicense, address, paymentTerms etc.). For legacy migrations with sparse
// data we default missing strings to '' so users aren't blocked — admin can
// fix later via the form. Only name + phone are import-required.
export class ImportSupplierDto {
  @IsOptional() @IsInt() sourceRow?: number;
  @IsOptional() @IsString() supplierCode?: string;

  @IsString() name!: string;
  @IsString() phone!: string;

  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() gstin?: string;
  @IsOptional() @IsString() drugLicense?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsEnum(PaymentTerms) paymentTerms?: PaymentTerms;
  @IsOptional() @IsString() bankDetails?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  // Opening payable — written verbatim to Supplier.currentOutstanding.
  @IsOptional() @IsNumber() openingBalance?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportPurchaseOrderDto)
  purchaseOrders?: ImportPurchaseOrderDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportGrnDto)
  grns?: ImportGrnDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportDebitNoteDto)
  debitNotes?: ImportDebitNoteDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportSupplierActivityDto)
  activities?: ImportSupplierActivityDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportBatchDto)
  batches?: ImportBatchDto[];
}

export class ImportSuppliersDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ImportSupplierDto)
  suppliers!: ImportSupplierDto[];

  @IsIn(['UPDATE', 'SKIP', 'CREATE'])
  duplicateHandling!: ImportDuplicateHandling;

  @IsOptional() @IsBoolean() dryRun?: boolean;
}

// ─── Result shapes ─────────────────────────────────────────────────────────

export interface ImportRowError {
  sheet:
    | 'Suppliers'
    | 'Purchase Orders'
    | 'PO Items'
    | 'GRNs'
    | 'GRN Items'
    | 'Debit Notes'
    | 'Debit Note Items'
    | 'Activities'
    | 'Batches';
  row: number;
  supplierCode?: string;
  field?: string;
  message: string;
}

export interface ImportRowWarning extends ImportRowError {
  kind: 'duplicate' | 'missing-link' | 'coerced';
}

export interface ImportDuplicateMatch {
  supplierCode?: string;
  sourceRow: number;
  action: 'will-update' | 'will-skip' | 'will-create-new';
  existingSupplier: {
    id: string;
    name: string;
    phone: string;
  };
}

export interface ImportSummary {
  suppliers: {
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  purchaseOrders: { created: number; skipped: number; failed: number };
  poItems: { created: number };
  grns: { created: number; skipped: number; failed: number };
  grnItems: { created: number };
  debitNotes: { created: number; skipped: number; failed: number };
  debitNoteItems: { created: number };
  activities: { created: number; failed: number };
  batches: { created: number; skipped: number; failed: number };
  openingBalanceApplied: number;
}

export interface ImportResult {
  dryRun: boolean;
  summary: ImportSummary;
  duplicates: ImportDuplicateMatch[];
  errors: ImportRowError[];
  warnings: ImportRowWarning[];
}
