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
import {
  CustomerActivityStatus,
  CustomerActivityType,
  CustomerType,
  InvoiceStatus,
} from '@prisma/client';

// One workbook row may produce one customer + N invoices + N payments +
// N activities + N prescriptions. The frontend parses the multi-sheet
// workbook into this shape (customer_code → nested children) so the backend
// stays Excel-agnostic: it validates structured JSON and writes everything
// in a single Prisma transaction per commit.
export type ImportDuplicateHandling = 'UPDATE' | 'SKIP' | 'CREATE';

export class ImportInvoiceItemDto {
  @IsOptional() @IsString() productName?: string;
  @IsOptional() @IsString() batchNumber?: string;
  @IsOptional() @IsString() expiryDate?: string; // ISO string; service coerces
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsNumber() mrp?: number;
  @IsOptional() @IsNumber() rate?: number;
  @IsOptional() @IsNumber() discountPercent?: number;
  @IsOptional() @IsNumber() gstPercent?: number;
  @IsOptional() @IsNumber() amount?: number;
}

export class ImportInvoiceDto {
  // Row index from the source workbook — surfaced back in errors so the user
  // can find and fix the bad row in Excel.
  @IsOptional() @IsInt() sourceRow?: number;

  // Optional user-provided invoice number. If absent, service generates one
  // via DocumentNumberingService at commit time.
  @IsOptional() @IsString() invoiceNumber?: string;

  @IsOptional() @IsString() date?: string; // ISO; defaults to today if absent

  @IsOptional() @IsString() notes?: string;

  // Money fields. We preserve whatever the user provides — these are
  // historical records, recomputing them would silently rewrite history.
  @IsOptional() @IsNumber() subtotal?: number;
  @IsOptional() @IsNumber() productDiscount?: number;
  @IsOptional() @IsNumber() taxableAmount?: number;
  @IsOptional() @IsNumber() cgst?: number;
  @IsOptional() @IsNumber() sgst?: number;
  @IsOptional() @IsNumber() igst?: number;
  @IsOptional() @IsNumber() deliveryCharge?: number;
  @IsOptional() @IsNumber() roundOff?: number;
  @IsOptional() @IsNumber() grandTotal?: number;
  @IsOptional() @IsNumber() amountPaid?: number;

  // Free-text payment mode + status. We validate against the Prisma enums
  // server-side; frontend uppercases for tolerance.
  @IsOptional() @IsString() paymentMode?: string;
  @IsOptional() @IsEnum(InvoiceStatus) status?: InvoiceStatus;

  // 'RETAIL' | 'WHOLESALE' — defaults to the customer's type if unset.
  @IsOptional() @IsString() billingType?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportInvoiceItemDto)
  items?: ImportInvoiceItemDto[];
}

export class ImportPaymentDto {
  @IsOptional() @IsInt() sourceRow?: number;
  @IsOptional() @IsString() receiptNumber?: string;
  @IsOptional() @IsString() date?: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsString() paymentMode?: string; // CASH | CARD | UPI | CHEQUE | NEFT | etc.
  @IsOptional() @IsString() referenceNumber?: string;
  @IsOptional() @IsString() notes?: string;
}

export class ImportActivityDto {
  @IsOptional() @IsInt() sourceRow?: number;
  @IsEnum(CustomerActivityType) type!: CustomerActivityType;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() occurredAt?: string;
  @IsOptional() @IsString() dueAt?: string;
  @IsOptional() @IsEnum(CustomerActivityStatus) status?: CustomerActivityStatus;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() subject?: string;
}

export class ImportPrescriptionDto {
  @IsOptional() @IsInt() sourceRow?: number;
  @IsString() doctorName!: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() validUntil?: string;
}

export class ImportCreditNoteItemDto {
  @IsOptional() @IsString() productName?: string;
  @IsOptional() @IsString() batchNumber?: string;
  @IsOptional() @IsString() expiryDate?: string;
  @IsOptional() @IsNumber() returnedQty?: number;
  @IsOptional() @IsNumber() rate?: number;
  @IsOptional() @IsNumber() gstPercent?: number;
  @IsOptional() @IsNumber() amount?: number;
}

export class ImportCreditNoteDto {
  @IsOptional() @IsInt() sourceRow?: number;
  // Legacy credit-note number from the source system. Idempotency mirror of
  // invoice_number / receipt_number — auto-generate only when blank.
  @IsOptional() @IsString() creditNoteNo?: string;
  // REQUIRED: which invoice this credit note is against. We resolve it to an
  // Invoice row by (invoiceNumber + customerId) at write time.
  @IsString() invoiceNumber!: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsNumber() subtotal?: number;
  @IsOptional() @IsNumber() cgst?: number;
  @IsOptional() @IsNumber() sgst?: number;
  @IsOptional() @IsNumber() igst?: number;
  @IsOptional() @IsNumber() totalAmount?: number;
  // REFUND | CREDIT | REPLACEMENT — validated server-side.
  @IsOptional() @IsString() settlementMode?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCreditNoteItemDto)
  items?: ImportCreditNoteItemDto[];
}

export class ImportQuotationItemDto {
  @IsOptional() @IsString() productName?: string;
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsNumber() mrp?: number;
  @IsOptional() @IsNumber() rate?: number;
  @IsOptional() @IsNumber() discountPercent?: number;
  @IsOptional() @IsNumber() gstPercent?: number;
  @IsOptional() @IsNumber() amount?: number;
}

export class ImportQuotationDto {
  @IsOptional() @IsInt() sourceRow?: number;
  // Legacy quotation number from the source system. Same idempotency model
  // as invoice_number / receipt_number — auto-generate only when blank.
  @IsOptional() @IsString() quotationNumber?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() validUntil?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsNumber() subtotal?: number;
  @IsOptional() @IsNumber() cgst?: number;
  @IsOptional() @IsNumber() sgst?: number;
  @IsOptional() @IsNumber() deliveryCharge?: number;
  @IsOptional() @IsNumber() total?: number;
  // DRAFT | SENT | ACCEPTED | REJECTED | CONVERTED — validated server-side.
  @IsOptional() @IsString() status?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportQuotationItemDto)
  items?: ImportQuotationItemDto[];
}

export class ImportCustomerDto {
  @IsOptional() @IsInt() sourceRow?: number;

  // Optional user-defined code from the workbook. Used by the frontend to
  // join sheets — never persisted. Kept here so we can echo it in error rows.
  @IsOptional() @IsString() customerCode?: string;

  @IsString() name!: string;

  @IsString() phone!: string;

  @IsOptional() @IsString() alternatePhone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsEnum(CustomerType) type?: CustomerType;
  @IsOptional() @IsString() doctorRef?: string;
  @IsOptional() @IsString() referredBy?: string;
  @IsOptional() @IsNumber() creditLimit?: number;
  // Opening outstanding balance migrated from the legacy system. Written to
  // Customer.currentOutstanding verbatim — we don't synthesise a phantom
  // invoice for it (those would distort future ageing/reporting).
  @IsOptional() @IsNumber() openingBalance?: number;
  @IsOptional() @IsInt() @Min(0) loyaltyPoints?: number;
  @IsOptional() @IsString() gstin?: string;
  @IsOptional() @IsString() dlNumber?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsBoolean() whatsappOptIn?: boolean;
  @IsOptional() @IsString() whatsappNumber?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportInvoiceDto)
  invoices?: ImportInvoiceDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportPaymentDto)
  payments?: ImportPaymentDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportActivityDto)
  activities?: ImportActivityDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportPrescriptionDto)
  prescriptions?: ImportPrescriptionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportQuotationDto)
  quotations?: ImportQuotationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCreditNoteDto)
  creditNotes?: ImportCreditNoteDto[];
}

export class ImportCustomersDto {
  @IsArray()
  // Hard cap to keep one transaction within sane bounds. The frontend
  // surfaces this number in the upload UI so the user knows what to expect.
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ImportCustomerDto)
  customers!: ImportCustomerDto[];

  @IsIn(['UPDATE', 'SKIP', 'CREATE'])
  duplicateHandling!: ImportDuplicateHandling;

  // If true, runs the same validation/match logic but never writes. The
  // controller maps this to the /preview route — kept as a flag too so a
  // single service method handles both paths without divergence.
  @IsOptional() @IsBoolean() dryRun?: boolean;
}

// ─── Result shapes ─────────────────────────────────────────────────────────

export interface ImportRowError {
  // Which sheet the bad row came from — surfaced verbatim in the UI.
  sheet:
    | 'Customers'
    | 'Invoices'
    | 'Invoice Items'
    | 'Payments'
    | 'Activities'
    | 'Prescriptions'
    | 'Quotations'
    | 'Quotation Items'
    | 'Credit Notes'
    | 'Credit Note Items';
  row: number;
  customerCode?: string;
  field?: string;
  message: string;
}

export interface ImportRowWarning extends ImportRowError {
  kind: 'duplicate' | 'missing-link' | 'coerced';
}

export interface ImportDuplicateMatch {
  customerCode?: string;
  sourceRow: number;
  // What action will be taken under the current duplicateHandling setting.
  action: 'will-update' | 'will-skip' | 'will-create-new';
  existingCustomer: {
    id: string;
    name: string;
    phone: string;
  };
}

export interface ImportSummary {
  customers: {
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  // `skipped` counts rows we *intentionally* didn't write because the
  // user-provided number already exists in the DB (idempotent re-import).
  // `failed` is reserved for genuine errors that need user intervention.
  invoices: { created: number; skipped: number; failed: number };
  invoiceItems: { created: number };
  payments: { created: number; skipped: number; failed: number };
  activities: { created: number; failed: number };
  prescriptions: { created: number; failed: number };
  quotations: { created: number; skipped: number; failed: number };
  quotationItems: { created: number };
  creditNotes: { created: number; skipped: number; failed: number };
  creditNoteItems: { created: number };
  openingBalanceApplied: number;
}

export interface ImportResult {
  dryRun: boolean;
  summary: ImportSummary;
  duplicates: ImportDuplicateMatch[];
  errors: ImportRowError[];
  warnings: ImportRowWarning[];
}
