import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { SettingsService } from '../settings/settings.service';
import { InvoiceCreatedListener } from '../events/invoice-created.listener';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';

// ─────────────────────────────────────────────────────────────
// Smoke tests for the editUnpaidInvoice flow.
// The Prisma client is fully mocked — these exercise business
// logic (status transitions, refusal cases, stock/ledger reversal)
// without touching a real database.
// ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mock<T = any> = jest.Mock<Promise<T>, any[]>;

interface MockTx {
  invoice: { findUnique: Mock; update: Mock };
  invoiceItem: { deleteMany: Mock; update: Mock };
  batch: { update: Mock; findUnique: Mock; findFirst: Mock; findMany: Mock; updateMany: Mock };
  product: { update: Mock; findMany: Mock; findUnique: Mock };
  customer: { update: Mock };
  payment: { create: Mock };
  prescription: { findFirst: Mock };
  notification: { findFirst: Mock; create: Mock; updateMany: Mock };
  invoiceEditAudit: { create: Mock };
}

function makeTx(overrides: Partial<MockTx> = {}): MockTx {
  return {
    invoice: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    invoiceItem: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      // Per-line flush used by convertToInvoice to write the resolved
      // batch / cost back onto the quotation's own rows.
      update: jest.fn().mockResolvedValue({}),
    },
    batch: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      // FEFO fallback — only consulted when a line arrives without a batchId.
      findFirst: jest.fn().mockResolvedValue(null),
      // Bulk cost lookup for the InvoiceItem.unitCost snapshot
      // (resolveItemUnitCosts). Empty => every line falls through to the
      // product master's purchaseRate, which these fixtures also leave at 0;
      // unitCost isn't what this suite asserts on, it just must not throw.
      findMany: jest.fn().mockResolvedValue([]),
      // Atomic, race-safe decrement (count: 1 = the conditional update applied).
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    product: {
      update: jest.fn().mockResolvedValue({ totalStock: 100, minStock: 0, branchId: null }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    customer: { update: jest.fn().mockResolvedValue({}) },
    payment: { create: jest.fn().mockResolvedValue({}) },
    prescription: { findFirst: jest.fn().mockResolvedValue({ id: 'rx1' }) },
    notification: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    invoiceEditAudit: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

function buildInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-2026-0001',
    type: 'INVOICE',
    status: 'UNPAID',
    billingType: 'RETAIL',
    branchId: 'br-1',
    customerId: 'cust-1',
    customerName: 'Acme Hospital',
    doctorName: null,
    salespersonId: null,
    salespersonName: null,
    subtotal: 1000,
    productDiscount: 0,
    taxableAmount: 1000,
    cgst: 60,
    sgst: 60,
    igst: 0,
    deliveryCharge: 0,
    roundOff: 0,
    grandTotal: 1120,
    paymentMode: 'CREDIT',
    paymentDetails: null,
    amountPaid: 0,
    creditNotes: [],
    items: [
      {
        id: 'item-1',
        productId: 'prod-A',
        productName: 'Paracetamol 500',
        batchId: 'batch-A',
        batchNumber: 'B-A1',
        quantity: 10,
        mrp: 10,
        rate: 100,
        discountPercent: 0,
        gstPercent: 12,
        amount: 1000,
      },
    ],
    ...overrides,
  };
}

function buildDto(overrides: Partial<CreateInvoiceDto> = {}): CreateInvoiceDto {
  return {
    type: 'INVOICE',
    billingType: 'RETAIL',
    customerId: 'cust-1',
    customerName: 'Acme Hospital',
    items: [
      {
        productId: 'prod-A',
        productName: 'Paracetamol 500',
        batchId: 'batch-A',
        batchNumber: 'B-A1',
        expiryDate: '2030-01-01',
        quantity: 12,
        mrp: 10,
        rate: 100,
        discountPercent: 0,
        gstPercent: 12,
        amount: 1200,
      },
    ],
    subtotal: 1200,
    productDiscount: 0,
    taxableAmount: 1200,
    cgst: 72,
    sgst: 72,
    igst: 0,
    deliveryCharge: 0,
    roundOff: 0,
    grandTotal: 1344,
    paymentMode: 'CREDIT',
    status: 'UNPAID',
    amountPaid: 0,
    changeReturned: 0,
    ...overrides,
  } as CreateInvoiceDto;
}

describe('BillingService.editUnpaidInvoice', () => {
  let service: BillingService;
  let prisma: { $transaction: jest.Mock };
  let tx: MockTx;

  beforeEach(async () => {
    tx = makeTx();
    prisma = {
      $transaction: jest.fn((cb: (t: MockTx) => unknown) => Promise.resolve(cb(tx))),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ApprovalsService, useValue: { createRequest: jest.fn() } },
        {
          provide: DocumentNumberingService,
          useValue: {
            nextNumber: jest.fn().mockResolvedValue('INV-2026-0002'),
            // Pass-through: the real one only re-runs `operation` on a P2002
            // document-number collision, which no fixture here provokes. Calling
            // it once is exactly the production happy path.
            retryOnCollision: jest.fn((op: () => unknown) => op()),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        // BillingService holds a direct reference to the listener (not just the
        // event bus) so emitInvoiceCreatedById() can await the WhatsApp send and
        // report its outcome synchronously. Neither editUnpaidInvoice nor
        // collectPayment touches it — an inert stub keeps the DI graph closed
        // without dragging in Razorpay / R2 / puppeteer.
        { provide: InvoiceCreatedListener, useValue: { handle: jest.fn() } },
        // These specs cover the stock-tracking-ON behaviour (the historical
        // default), so the master switch is stubbed enabled.
        {
          provide: SettingsService,
          useValue: { isStockTrackingEnabled: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();

    service = moduleRef.get<BillingService>(BillingService);
  });

  // ── Refusal cases ──────────────────────────────────────────

  it('rejects when the invoice does not exist', async () => {
    tx.invoice.findUnique.mockResolvedValue(null);
    await expect(service.editUnpaidInvoice('missing', buildDto(), 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when the status is CANCELLED (financially closed)', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ status: 'CANCELLED' }));
    await expect(service.editUnpaidInvoice('inv-1', buildDto(), 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the status is RETURNED (credit note carries the counterweight)', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ status: 'RETURNED' }));
    await expect(service.editUnpaidInvoice('inv-1', buildDto(), 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when a credit note is already linked', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ creditNotes: [{ id: 'cn-1' }] }));
    await expect(service.editUnpaidInvoice('inv-1', buildDto(), 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the new grand total is below the amount already collected (refund-protection)', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ status: 'PARTIAL', amountPaid: 800 }));
    await expect(
      service.editUnpaidInvoice('inv-1', buildDto({ grandTotal: 500 }), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the record is a QUOTATION rather than an invoice', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ type: 'QUOTATION' }));
    await expect(service.editUnpaidInvoice('inv-1', buildDto(), 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the invoice belongs to a different branch', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ branchId: 'br-other' }));
    await expect(service.editUnpaidInvoice('inv-1', buildDto(), 'user-1', 'br-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── Happy path: stock / ledger reversal ─────────

  it('restores old stock and deducts new stock atomically', async () => {
    const existing = buildInvoice();
    tx.invoice.findUnique.mockResolvedValue(existing);
    // batch present + non-expired + has enough quantity for the new line
    tx.batch.findUnique.mockResolvedValue({
      id: 'batch-A',
      quantity: 50,
      expiryDate: new Date('2030-12-31'),
    });
    tx.invoice.update.mockResolvedValue({ ...existing, status: 'UNPAID', items: [] });

    await service.editUnpaidInvoice('inv-1', buildDto({ grandTotal: 1344 }), 'user-1');

    // Old item quantity (10) restored to the batch and product. The restore
    // goes through updateMany (not update) so a line whose batch is missing or
    // blank — imported invoices, and lines billed while stock tracking was OFF —
    // is a 0-row no-op rather than a P2025 that aborts the whole edit.
    const restoreCalls = tx.batch.updateMany.mock.calls.filter((c: any[]) =>
      JSON.stringify(c[0]?.data ?? {}).includes('"increment":10'),
    );
    expect(restoreCalls.length).toBeGreaterThanOrEqual(1);

    const productRestores = tx.product.update.mock.calls.filter((c: any[]) =>
      JSON.stringify(c[0]?.data ?? {}).includes('"increment":10'),
    );
    expect(productRestores.length).toBeGreaterThanOrEqual(1);

    // Then the new quantity (12) deducted via deductStockForItem using the
    // atomic, race-safe conditional decrement (updateMany with a `gte` guard).
    const newDeductCalls = tx.batch.updateMany.mock.calls.filter((c: any[]) =>
      c[0]?.data?.quantity?.decrement === 12 && c[0]?.where?.quantity?.gte === 12,
    );
    expect(newDeductCalls.length).toBe(1);
  });

  it('reverses the old customer outstanding and re-applies the new outstanding', async () => {
    // Existing UNPAID invoice of 1120 with 0 paid → outstanding=1120
    tx.invoice.findUnique.mockResolvedValue(buildInvoice());
    tx.batch.findUnique.mockResolvedValue({
      id: 'batch-A',
      quantity: 50,
      expiryDate: new Date('2030-12-31'),
    });
    tx.invoice.update.mockResolvedValue({ ...buildInvoice(), status: 'UNPAID', items: [] });

    await service.editUnpaidInvoice('inv-1', buildDto({ grandTotal: 1344 }), 'user-1');

    const customerOps = tx.customer.update.mock.calls.map((c: any[]) => c[0]?.data);
    // Decrement the old outstanding of 1120
    expect(customerOps).toEqual(
      expect.arrayContaining([{ currentOutstanding: { decrement: 1120 } }]),
    );
    // Then increment by the new outstanding of 1344
    expect(customerOps).toEqual(
      expect.arrayContaining([{ currentOutstanding: { increment: 1344 } }]),
    );
  });

  it('writes a before/after audit row', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice());
    tx.batch.findUnique.mockResolvedValue({
      id: 'batch-A',
      quantity: 50,
      expiryDate: new Date('2030-12-31'),
    });
    tx.invoice.update.mockResolvedValue({
      ...buildInvoice(),
      status: 'UNPAID',
      grandTotal: 1344,
      items: [{ ...buildInvoice().items[0], quantity: 12, amount: 1200 }],
    });

    await service.editUnpaidInvoice('inv-1', buildDto({ grandTotal: 1344 }), 'user-7');

    expect(tx.invoiceEditAudit.create).toHaveBeenCalledTimes(1);
    const call = tx.invoiceEditAudit.create.mock.calls[0][0];
    expect(call.data.invoiceId).toBe('inv-1');
    expect(call.data.editedById).toBe('user-7');
    expect(call.data.before.grandTotal).toBe(1120);
    expect(call.data.before.items[0].quantity).toBe(10);
    expect(call.data.after.grandTotal).toBe(1344);
    expect(call.data.after.items[0].quantity).toBe(12);
  });

  // ── Status transition matrix ──────────────────────────────

  it('transitions PARTIAL to PAID when the new grand total is fully covered by amountPaid', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ status: 'PARTIAL', amountPaid: 1000 }));
    tx.batch.findUnique.mockResolvedValue({
      id: 'batch-A',
      quantity: 50,
      expiryDate: new Date('2030-12-31'),
    });
    tx.invoice.update.mockResolvedValue({ ...buildInvoice(), status: 'PAID' });

    // New grand total 1000 — fully covered by amountPaid 1000
    await service.editUnpaidInvoice('inv-1', buildDto({ grandTotal: 1000, amountPaid: 1000 }), 'u1');

    const lastUpdate = tx.invoice.update.mock.calls[0][0];
    expect(lastUpdate.data.status).toBe('PAID');
  });

  it('keeps status as PARTIAL when amountPaid is between 0 and the new grand total', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ status: 'PARTIAL', amountPaid: 500 }));
    tx.batch.findUnique.mockResolvedValue({
      id: 'batch-A',
      quantity: 50,
      expiryDate: new Date('2030-12-31'),
    });
    tx.invoice.update.mockResolvedValue({ ...buildInvoice(), status: 'PARTIAL' });

    await service.editUnpaidInvoice('inv-1', buildDto({ grandTotal: 1344 }), 'u1');

    const lastUpdate = tx.invoice.update.mock.calls[0][0];
    expect(lastUpdate.data.status).toBe('PARTIAL');
  });

  // NOTE: this case used to start from status='PAID'. Commit bf542df added a
  // server-side guard rejecting edits to PAID invoices (see below), which made
  // the old fixture unreachable. The *ledger* behaviour it was pinning — an
  // invoice whose balance is already fully collected takes no decrement, only
  // an increment for the newly-created shortfall — is unchanged, so the fixture
  // is restated as a fully-collected PARTIAL invoice (grandTotal == amountPaid,
  // a real state: see the `due == 0 but status PARTIAL` row the outstanding
  // KPI spec guards against). Every assertion below is the original one.
  it('adds only the new shortfall when the old balance was already fully collected', async () => {
    // grandTotal=1120, amountPaid=1120 → old outstanding = 0
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ status: 'PARTIAL', amountPaid: 1120 }));
    tx.batch.findUnique.mockResolvedValue({
      id: 'batch-A',
      quantity: 50,
      expiryDate: new Date('2030-12-31'),
    });
    tx.invoice.update.mockResolvedValue({ ...buildInvoice(), status: 'PARTIAL' });

    // Customer added more items — new grand total 1500, money already paid is 1120
    await service.editUnpaidInvoice('inv-1', buildDto({ grandTotal: 1500 }), 'u1');

    const updateData = tx.invoice.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('PARTIAL');

    // Customer outstanding ledger: old outstanding was 0 (PAID), so no
    // decrement; the new shortfall (1500 - 1120 = 380) should be added.
    const customerOps = tx.customer.update.mock.calls.map((c: any[]) => c[0]?.data);
    expect(customerOps).toEqual(expect.arrayContaining([{ currentOutstanding: { increment: 380 } }]));
    expect(customerOps).not.toEqual(expect.arrayContaining([{ currentOutstanding: { decrement: 0 } }]));
  });

  // Replaces the former 'keeps a PAID invoice as PAID …' case. Editing a PAID
  // invoice stopped being legal in commit bf542df: the sale is fully settled,
  // so a correction has to leave an audit trail as a credit note rather than a
  // silent edit. That test had been asserting the pre-guard behaviour and was
  // only ever green because the whole suite crashed on puppeteer's ESM before
  // it could run. Pin the guard instead — it belongs with the CANCELLED /
  // RETURNED refusals above.
  it('rejects when the status is PAID (fully settled — correct via credit note)', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ status: 'PAID', amountPaid: 1120 }));
    await expect(
      service.editUnpaidInvoice('inv-1', buildDto({ grandTotal: 1120 }), 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps status as UNPAID when amountPaid is zero', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ status: 'UNPAID', amountPaid: 0 }));
    tx.batch.findUnique.mockResolvedValue({
      id: 'batch-A',
      quantity: 50,
      expiryDate: new Date('2030-12-31'),
    });
    tx.invoice.update.mockResolvedValue({ ...buildInvoice(), status: 'UNPAID' });

    await service.editUnpaidInvoice('inv-1', buildDto({ grandTotal: 2000 }), 'u1');

    const lastUpdate = tx.invoice.update.mock.calls[0][0];
    expect(lastUpdate.data.status).toBe('UNPAID');
  });

  it('does not overwrite amountPaid — money already collected is preserved', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ status: 'PARTIAL', amountPaid: 500 }));
    tx.batch.findUnique.mockResolvedValue({
      id: 'batch-A',
      quantity: 50,
      expiryDate: new Date('2030-12-31'),
    });
    tx.invoice.update.mockResolvedValue({ ...buildInvoice(), status: 'PARTIAL' });

    await service.editUnpaidInvoice('inv-1', buildDto({ grandTotal: 2000, amountPaid: 999 }), 'u1');

    const updateData = tx.invoice.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('amountPaid');
  });

  // ── Sanity: existing methods still resolvable from DI ─────

  it('is wired into the DI container', () => {
    expect(service).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// collectPayment keeps the invoice's PAYMENT_DUE reminder in sync:
//   full payment → resolve it; partial payment → refresh the amount.
// ─────────────────────────────────────────────────────────────
describe('BillingService.collectPayment — Payment Due sync', () => {
  let service: BillingService;
  let prisma: { $transaction: jest.Mock };
  let tx: MockTx;

  beforeEach(async () => {
    tx = makeTx();
    prisma = {
      $transaction: jest.fn((cb: (t: MockTx) => unknown) => Promise.resolve(cb(tx))),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ApprovalsService, useValue: { createRequest: jest.fn() } },
        {
          provide: DocumentNumberingService,
          useValue: {
            nextNumber: jest.fn().mockResolvedValue('RCPT-0001'),
            retryOnCollision: jest.fn((op: () => unknown) => op()),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        // BillingService holds a direct reference to the listener (not just the
        // event bus) so emitInvoiceCreatedById() can await the WhatsApp send and
        // report its outcome synchronously. Neither editUnpaidInvoice nor
        // collectPayment touches it — an inert stub keeps the DI graph closed
        // without dragging in Razorpay / R2 / puppeteer.
        { provide: InvoiceCreatedListener, useValue: { handle: jest.fn() } },
        // These specs cover the stock-tracking-ON behaviour (the historical
        // default), so the master switch is stubbed enabled.
        {
          provide: SettingsService,
          useValue: { isStockTrackingEnabled: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();
    service = moduleRef.get<BillingService>(BillingService);
  });

  it('resolves the reminder when the payment clears the invoice (→ PAID)', async () => {
    // grandTotal 1120, nothing paid → a full 1120 payment settles it.
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ amountPaid: 0 }));
    tx.invoice.update.mockResolvedValue({ ...buildInvoice(), status: 'PAID', items: [] });

    await service.collectPayment('inv-1', 1120, 'CASH');

    expect(tx.notification.updateMany).toHaveBeenCalledTimes(1);
    const call = tx.notification.updateMany.mock.calls[0][0];
    expect(call.where.type).toBe('PAYMENT_DUE');
    expect(call.where.message.contains).toBe('[invoiceId:inv-1]');
    expect(call.where.resolvedAt).toBeNull();
    // Resolve semantics: marks it resolved + read so it leaves the Unread list.
    expect(call.data.resolvedAt).toBeInstanceOf(Date);
    expect(call.data.isRead).toBe(true);
    expect(call.data.message).toBeUndefined();
  });

  it('refreshes the reminder amount on a partial payment (→ PARTIAL)', async () => {
    // grandTotal 1120, nothing paid → a 500 payment leaves 620 outstanding.
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ amountPaid: 0 }));
    tx.invoice.update.mockResolvedValue({ ...buildInvoice(), status: 'PARTIAL', items: [] });

    await service.collectPayment('inv-1', 500, 'CASH');

    expect(tx.notification.updateMany).toHaveBeenCalledTimes(1);
    const call = tx.notification.updateMany.mock.calls[0][0];
    expect(call.where.message.contains).toBe('[invoiceId:inv-1]');
    // Refresh semantics: rewrites the message with the new balance, stays active.
    expect(call.data.message).toContain('₹620.00 outstanding');
    expect(call.data.message).toContain('[invoiceId:inv-1]');
    expect(call.data.resolvedAt).toBeUndefined();
    expect(call.data.isRead).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Quotation → invoice conversion.
//
// This path had NO coverage at all, which is why a whole class of bug lived in
// it undetected: conversion reuses the quotation's own InvoiceItem rows instead
// of recreating them, so anything deductStockForItem resolves has to be flushed
// back explicitly. Quotation rows start deliberately blank — batchId '',
// batchNumber '', stockApplied false, unitCost 0 — because a quotation reserves
// nothing. If the flush drops a field the invoice ends up claiming no batch for
// goods that really drained one specific batch, and the damage is silent and
// downstream: the printed bill shows an em dash for Batch No. / Expiry, the
// product timeline never attributes the sale to the batch it drained, and a
// later credit note finds nothing to restore stock into.
//
// The two stock-tracking modes write deliberately DIFFERENT column sets, so
// both are pinned here.
// ─────────────────────────────────────────────────────────────
describe('BillingService.convertToInvoice — quotation to invoice', () => {
  let service: BillingService;
  let tx: MockTx;
  let stockTrackingEnabled: boolean;

  // The batch FEFO settles on when tracking is ON. Its purchaseRate (70) is
  // deliberately different from the product master's (42) so the unitCost
  // assertions can tell which source was used — that precedence (batch first,
  // master only as fallback) is the whole point of the snapshot.
  const FEFO_BATCH = {
    id: 'batch-F',
    batchNumber: 'B-F9',
    expiryDate: new Date('2030-12-31'),
    mrp: 120,
    purchaseRate: 70,
    quantity: 100,
  };
  const MASTER_PURCHASE_RATE = 42;

  // A quotation line as actually stored: blank batch fields, stockApplied
  // false, unitCost 0, and an mrp of 0 the operator never filled in.
  function buildQuotation(overrides: Record<string, unknown> = {}) {
    return {
      id: 'qtn-1',
      invoiceNumber: 'QTN/26-27/00007',
      type: 'QUOTATION',
      status: 'UNPAID',
      billingType: 'RETAIL',
      branchId: 'br-1',
      customerId: 'cust-1',
      customerName: 'Acme Hospital',
      grandTotal: 1120,
      amountPaid: 0,
      items: [
        {
          id: 'qitem-1',
          productId: 'prod-A',
          productName: 'Paracetamol 500',
          batchId: '',
          batchNumber: '',
          expiryDate: '2027-06-30', // free text the operator typed on the quote
          quantity: 10,
          rate: 100,
          mrp: 0,
          stockApplied: false,
          unitCost: 0,
        },
      ],
      ...overrides,
    };
  }

  beforeEach(async () => {
    stockTrackingEnabled = true;
    tx = makeTx();
    tx.invoice.findUnique.mockResolvedValue(buildQuotation());
    tx.invoice.update.mockResolvedValue({ ...buildQuotation(), type: 'INVOICE' });
    // One delegate serving two different callers:
    //   - assertPrescriptionForScheduledItems reads `schedule` (null => not a
    //     Schedule H/H1/X drug, so no prescription is demanded);
    //   - resolveItemUnitCosts reads `purchaseRate` (the product-master
    //     fallback cost).
    tx.product.findMany.mockResolvedValue([
      { id: 'prod-A', name: 'Paracetamol 500', schedule: null, purchaseRate: MASTER_PURCHASE_RATE },
    ]);
    // The line carries no batchId, so deductStockForItem goes down the FEFO path.
    tx.batch.findFirst.mockResolvedValue(FEFO_BATCH);
    tx.batch.findMany.mockResolvedValue([
      { id: FEFO_BATCH.id, purchaseRate: FEFO_BATCH.purchaseRate },
    ]);

    const prisma = {
      $transaction: jest.fn((cb: (t: MockTx) => unknown) => Promise.resolve(cb(tx))),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: ApprovalsService, useValue: { createRequest: jest.fn() } },
        {
          provide: DocumentNumberingService,
          useValue: {
            nextNumber: jest.fn().mockResolvedValue('INV/26-27/00042'),
            retryOnCollision: jest.fn((op: () => unknown) => op()),
          },
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: InvoiceCreatedListener, useValue: { handle: jest.fn() } },
        {
          provide: SettingsService,
          // Read through the mutable flag rather than a fixed value so each
          // test picks its tracking mode without rebuilding the module.
          useValue: {
            isStockTrackingEnabled: jest.fn(async () => stockTrackingEnabled),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<BillingService>(BillingService);
  });

  // ── Refusal cases ──────────────────────────────────────────

  it('rejects when the record is not a QUOTATION', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildQuotation({ type: 'INVOICE' }));
    await expect(service.convertToInvoice('qtn-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the quotation belongs to a different branch', async () => {
    await expect(service.convertToInvoice('qtn-1', 'br-other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects when the quotation does not exist', async () => {
    tx.invoice.findUnique.mockResolvedValue(null);
    await expect(service.convertToInvoice('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── Stock tracking ON ──────────────────────────────────────

  it('reserves stock via FEFO and flushes the resolved batch back onto the line', async () => {
    await service.convertToInvoice('qtn-1', 'br-1');

    // Stock actually moved: the atomic conditional decrement ran for this line.
    expect(tx.batch.updateMany).toHaveBeenCalledTimes(1);
    const dec = tx.batch.updateMany.mock.calls[0][0];
    expect(dec.where.id).toBe(FEFO_BATCH.id);
    expect(dec.where.quantity.gte).toBe(10);
    expect(dec.data.quantity.decrement).toBe(10);
    expect(tx.product.update).toHaveBeenCalledTimes(1);

    // …and the row the customer's bill is printed from now names that batch.
    expect(tx.invoiceItem.update).toHaveBeenCalledTimes(1);
    const flush = tx.invoiceItem.update.mock.calls[0][0];
    expect(flush.where.id).toBe('qitem-1');
    expect(flush.data.batchId).toBe(FEFO_BATCH.id);
    expect(flush.data.batchNumber).toBe(FEFO_BATCH.batchNumber);
    expect(flush.data.expiryDate).toBe(FEFO_BATCH.expiryDate);
    // The quote left mrp at 0, so deductStockForItem backfills it off the batch.
    expect(flush.data.mrp).toBe(FEFO_BATCH.mrp);
    // The loop above reserved stock, so the sale really did move goods.
    expect(flush.data.stockApplied).toBe(true);
  });

  it('snapshots unitCost from the resolved batch, not the product master', async () => {
    await service.convertToInvoice('qtn-1', 'br-1');

    const flush = tx.invoiceItem.update.mock.calls[0][0];
    // 70 (batch) not 42 (master): the cost actually paid for the goods that
    // shipped. Costing at report time off the master would let the next GRN
    // re-price this already-closed sale.
    expect(flush.data.unitCost).toBe(FEFO_BATCH.purchaseRate);
    expect(flush.data.unitCost).not.toBe(MASTER_PURCHASE_RATE);
    // Resolved AFTER the deduct loop — any earlier and the batch lookup misses
    // the FEFO-selected id, so every tracked line silently falls back to the
    // master rate and the assertion above flips.
    expect(tx.batch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [FEFO_BATCH.id] } } }),
    );
  });

  it('renumbers the record as an invoice and marks it PAID', async () => {
    await service.convertToInvoice('qtn-1', 'br-1');

    expect(tx.invoice.update).toHaveBeenCalledTimes(1);
    const data = tx.invoice.update.mock.calls[0][0].data;
    expect(data.type).toBe('INVOICE');
    expect(data.invoiceNumber).toBe('INV/26-27/00042');
    expect(data.status).toBe('PAID');
  });

  // ── Stock tracking OFF ─────────────────────────────────────

  it('skips the deduct loop entirely when stock tracking is off', async () => {
    stockTrackingEnabled = false;

    await service.convertToInvoice('qtn-1', 'br-1');

    expect(tx.batch.findFirst).not.toHaveBeenCalled();
    expect(tx.batch.updateMany).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('writes only stockApplied=false + master unitCost when stock tracking is off', async () => {
    stockTrackingEnabled = false;

    await service.convertToInvoice('qtn-1', 'br-1');

    expect(tx.invoiceItem.update).toHaveBeenCalledTimes(1);
    const flush = tx.invoiceItem.update.mock.calls[0][0];
    expect(flush.where.id).toBe('qitem-1');

    // Exactly two columns — nothing resolved a batch, so the operator's own
    // batch / expiry / mrp free text must survive untouched. Asserted as the
    // full key set rather than field-by-field: a future edit slipping those
    // writes out of the `stockTracking &&` guard is exactly the regression
    // this catches.
    expect(Object.keys(flush.data).sort()).toEqual(['stockApplied', 'unitCost']);
    expect(flush.data.stockApplied).toBe(false);
    // 42 (product master) — with no batch there is nothing better to cost at,
    // but it still gets frozen so a later GRN can't re-price the sale.
    expect(flush.data.unitCost).toBe(MASTER_PURCHASE_RATE);
  });

  // ── MRP ceiling on the tracking-OFF path ───────────────────
  //
  // MRP is a legal ceiling (Drugs Price Control Order), so it must hold whether
  // or not stock is being counted. Conversion is the ONLY point a quoted price
  // is ever checked — create() deliberately skips the guards for a QUOTATION —
  // and with tracking ON the check rides inside deductStockForItem. Turning
  // tracking off removes that deduction, so without an explicit else-branch the
  // legal check disappeared with it and an over-MRP quote converted clean.

  it('refuses to convert a quotation priced above MRP when stock tracking is off', async () => {
    stockTrackingEnabled = false;
    // Master MRP 90 vs the quoted rate of 100.
    tx.product.findMany.mockResolvedValue([
      { id: 'prod-A', name: 'Paracetamol 500', schedule: null, mrp: 90, purchaseRate: MASTER_PURCHASE_RATE },
    ]);

    await expect(service.convertToInvoice('qtn-1', 'br-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.convertToInvoice('qtn-1', 'br-1')).rejects.toThrow(/exceeds its MRP/);
  });

  it('converts normally when the quoted rate is within MRP', async () => {
    stockTrackingEnabled = false;
    // Master MRP 150, comfortably above the quoted 100.
    tx.product.findMany.mockResolvedValue([
      { id: 'prod-A', name: 'Paracetamol 500', schedule: null, mrp: 150, purchaseRate: MASTER_PURCHASE_RATE },
    ]);

    await expect(service.convertToInvoice('qtn-1', 'br-1')).resolves.toBeDefined();
    expect(tx.invoiceItem.update).toHaveBeenCalledTimes(1);
  });

  it('does not re-block a below-cost quote — the price was already agreed', async () => {
    stockTrackingEnabled = false;
    // Quoted at 100 against a master cost of 400: below cost, but conversion
    // passes allowBelowCost:true, so only the hard MRP ceiling may bite here.
    tx.product.findMany.mockResolvedValue([
      { id: 'prod-A', name: 'Paracetamol 500', schedule: null, mrp: 500, purchaseRate: 400 },
    ]);

    await expect(service.convertToInvoice('qtn-1', 'br-1')).resolves.toBeDefined();
  });
});
