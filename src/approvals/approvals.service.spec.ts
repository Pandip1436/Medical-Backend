import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { CreditNotesService } from '../credit-notes/credit-notes.service';
import { PartyLinkService } from '../party-link/party-link.service';
import { GrnService } from '../grn/grn.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { SettingsService } from '../settings/settings.service';

// ─────────────────────────────────────────────────────────────
// Guards the ATOMICITY of the stock decrements in
// executeApprovedAction. Prisma is fully mocked — no database.
//
// A true race can't be reproduced against a mock, so these pin the
// contract that makes the race impossible instead:
//
//   * the availability check must live INSIDE the write, as a
//     `quantity: { gte: n }` guard in the WHERE clause, so the DB
//     evaluates it under the row lock; and
//   * the write must be RELATIVE (`decrement`), never an absolute
//     figure computed from an earlier read.
//
// The original code did read → check → `quantity: batch.quantity - n`,
// which under READ COMMITTED both overselds AND lost the concurrent
// update (it could even raise a batch's quantity, inventing stock).
// Neither symptom leaves a negative row behind, so nothing downstream
// would have caught it. If someone ever "simplifies" this back to a
// plain `batch.update`, these tests fail.
// ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mock<T = any> = jest.Mock<Promise<T>, any[]>;

interface MockTx {
  invoice: { findUnique: Mock; update: Mock };
  invoiceItem: { updateMany: Mock };
  batch: { findUnique: Mock; update: Mock; updateMany: Mock };
  product: { findMany: Mock; update: Mock };
  prescription: { findFirst: Mock };
  customer: { update: Mock };
}

const BATCH = {
  id: 'batch-A',
  batchNumber: 'AMX-221',
  // Comfortably in the future — the expiry guard runs before the decrement
  // and would otherwise mask what these tests are actually checking.
  expiryDate: new Date('2030-01-01'),
  quantity: 10,
};

function makeTx(overrides: Partial<MockTx> = {}): MockTx {
  return {
    invoice: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'inv-1',
        status: 'DRAFT',
        customerId: 'cust-1',
        items: [
          {
            productId: 'prod-A',
            productName: 'Amoxicillin 500',
            batchId: 'batch-A',
            batchNumber: 'AMX-221',
            quantity: 8,
          },
        ],
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    invoiceItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    batch: {
      findUnique: jest.fn().mockResolvedValue({ ...BATCH }),
      update: jest.fn().mockResolvedValue({}),
      // count: 1 => the guarded conditional update applied.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    product: {
      // Schedule NONE keeps the prescription branch out of the way.
      findMany: jest.fn().mockResolvedValue([
        { id: 'prod-A', name: 'Amoxicillin 500', schedule: 'NONE' },
      ]),
      update: jest.fn().mockResolvedValue({}),
    },
    prescription: { findFirst: jest.fn().mockResolvedValue({ id: 'rx-1' }) },
    customer: { update: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

describe('ApprovalsService — CREDIT_BILL stock reservation', () => {
  let service: ApprovalsService;
  let tx: MockTx;
  let settings: { isStockTrackingEnabled: jest.Mock };

  // executeApprovedAction is private; calling it directly keeps these tests on
  // the stock logic instead of dragging in the whole approve() review flow.
  const execCreditBill = () =>
    (service as any).executeApprovedAction('CREDIT_BILL', {}, 'inv-1', 'br-1');

  beforeEach(async () => {
    tx = makeTx();
    settings = { isStockTrackingEnabled: jest.fn().mockResolvedValue(true) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalsService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn((cb: (t: MockTx) => unknown) => Promise.resolve(cb(tx))),
            approvalRequest: { findUnique: jest.fn(), update: jest.fn() },
          },
        },
        { provide: DocumentNumberingService, useValue: { nextNumber: jest.fn(), retryOnCollision: jest.fn((op: () => unknown) => op()) } },
        { provide: CreditNotesService, useValue: {} },
        { provide: PartyLinkService, useValue: {} },
        { provide: GrnService, useValue: {} },
        { provide: SuppliersService, useValue: {} },
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();

    service = moduleRef.get<ApprovalsService>(ApprovalsService);
  });

  it('decrements the batch atomically, with the availability check in the WHERE', async () => {
    await execCreditBill();

    expect(tx.batch.updateMany).toHaveBeenCalledTimes(1);
    const [args] = tx.batch.updateMany.mock.calls[0];

    // The guard must be part of the write, not a separate read-then-check.
    expect(args.where).toEqual({ id: 'batch-A', quantity: { gte: 8 } });
    // Relative decrement — never an absolute value from a stale read.
    expect(args.data).toEqual({ quantity: { decrement: 8 } });
  });

  it('never writes an absolute quantity (the lost-update form)', async () => {
    await execCreditBill();

    // `batch.update` with `quantity: <number>` is precisely the bug: it
    // overwrites whatever a concurrent sale did, and can even raise the row.
    expect(tx.batch.update).not.toHaveBeenCalled();
  });

  it('refuses the approval when a concurrent sale took the stock first', async () => {
    // count: 0 => the `gte` guard did not match, i.e. someone else got there
    // first. This is the exact path that used to oversell silently.
    tx.batch.updateMany.mockResolvedValue({ count: 0 });
    tx.batch.findUnique.mockResolvedValue({ ...BATCH, quantity: 3 });

    await expect(execCreditBill()).rejects.toBeInstanceOf(BadRequestException);
    await expect(execCreditBill()).rejects.toThrow(/Available 3, needed 8/);
  });

  it('does not touch product.totalStock when the decrement was refused', async () => {
    // totalStock is decremented relatively, so letting it through after a
    // failed batch write is what breaks totalStock == SUM(batch.quantity).
    tx.batch.updateMany.mockResolvedValue({ count: 0 });
    tx.batch.findUnique.mockResolvedValue({ ...BATCH, quantity: 3 });

    await expect(execCreditBill()).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('skips stock entirely when Stock Tracking is off', async () => {
    settings.isStockTrackingEnabled.mockResolvedValue(false);

    await execCreditBill();

    expect(tx.batch.updateMany).not.toHaveBeenCalled();
    expect(tx.batch.update).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
    // The draft's lines never reserved stock, so the flag stays false.
    expect(tx.invoiceItem.updateMany).not.toHaveBeenCalled();
    // ...but the invoice still goes live.
    expect(tx.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'UNPAID' } }),
    );
  });

  it('still enforces the prescription rule when Stock Tracking is off', async () => {
    // Dispensing law is not inventory bookkeeping — it must not be gated on
    // the stock switch.
    settings.isStockTrackingEnabled.mockResolvedValue(false);
    tx.product.findMany.mockResolvedValue([
      { id: 'prod-A', name: 'Alprazolam', schedule: 'H1' },
    ]);
    tx.prescription.findFirst.mockResolvedValue(null);

    await expect(execCreditBill()).rejects.toThrow(/no active prescription/);
  });
});
