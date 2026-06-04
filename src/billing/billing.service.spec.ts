import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
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
  invoiceItem: { deleteMany: Mock };
  batch: { update: Mock; findUnique: Mock };
  product: { update: Mock; findMany: Mock };
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
    invoiceItem: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    batch: {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    product: {
      update: jest.fn().mockResolvedValue({ totalStock: 100, minStock: 0, branchId: null }),
      findMany: jest.fn().mockResolvedValue([]),
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
        { provide: DocumentNumberingService, useValue: { nextNumber: jest.fn().mockResolvedValue('INV-2026-0002') } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
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

    // Old item quantity (10) restored to the batch and product
    const restoreCalls = tx.batch.update.mock.calls.filter((c: any[]) =>
      JSON.stringify(c[0]?.data ?? {}).includes('"increment":10'),
    );
    expect(restoreCalls.length).toBeGreaterThanOrEqual(1);

    const productRestores = tx.product.update.mock.calls.filter((c: any[]) =>
      JSON.stringify(c[0]?.data ?? {}).includes('"increment":10'),
    );
    expect(productRestores.length).toBeGreaterThanOrEqual(1);

    // Then the new quantity (12) deducted via deductStockForItem
    const newDeductCalls = tx.batch.update.mock.calls.filter((c: any[]) =>
      typeof c[0]?.data?.quantity === 'number' && c[0].data.quantity === 50 - 12,
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

  it('flips a PAID invoice to PARTIAL when the new total is raised above the amount already paid', async () => {
    // Original PAID invoice: grandTotal=1120, amountPaid=1120, outstanding=0
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ status: 'PAID', amountPaid: 1120 }));
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

  it('keeps a PAID invoice as PAID when the new total equals the amount already paid', async () => {
    tx.invoice.findUnique.mockResolvedValue(buildInvoice({ status: 'PAID', amountPaid: 1120 }));
    tx.batch.findUnique.mockResolvedValue({
      id: 'batch-A',
      quantity: 50,
      expiryDate: new Date('2030-12-31'),
    });
    tx.invoice.update.mockResolvedValue({ ...buildInvoice(), status: 'PAID' });

    // Same total — only an item was reshuffled internally, money lines up
    await service.editUnpaidInvoice('inv-1', buildDto({ grandTotal: 1120 }), 'u1');

    const updateData = tx.invoice.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('PAID');
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
        { provide: DocumentNumberingService, useValue: { nextNumber: jest.fn().mockResolvedValue('RCPT-0001') } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
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
