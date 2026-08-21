import { Test, TestingModule } from '@nestjs/testing';
import { CustomerImportService } from './customer-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { PartyLinkService } from '../party-link/party-link.service';

// ─────────────────────────────────────────────────────────────
// Guards the core inventory invariant on the customer-history import:
//
//     Product.totalStock === SUM(batch.quantity)
//
// The Invoices sheet draws stock from existing batches FEFO-style, but the
// batches can run dry mid-line. It used to decrement totalStock by the
// quantity the invoice ASKED for while the batches only gave what they had,
// breaking the invariant by exactly the shortfall — silently, and in a way
// that survives into the period after Stock Tracking is switched on.
//
// Sourcing the decrement from what was actually applied also makes the path
// correct with tracking OFF for free: no batches means nothing is taken,
// so totalStock is left frozen, which is what that mode promises.
// ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mock<T = any> = jest.Mock<Promise<T>, any[]>;

const PRODUCT_ID = 'prod-A';

interface MockTx {
  customer: { findUnique: Mock };
  invoice: { create: Mock; findFirst: Mock };
  invoiceItem: { create: Mock };
  batch: { findMany: Mock; update: Mock };
  product: { findFirst: Mock; findMany: Mock; update: Mock };
}

function emptyResult(): any {
  return {
    errors: [],
    warnings: [],
    summary: {
      customers: { created: 0, updated: 0, skipped: 0, failed: 0 },
      invoices: { created: 0, skipped: 0, failed: 0 },
      invoiceItems: { created: 0 },
      creditNotes: { created: 0, skipped: 0, failed: 0 },
      creditNoteItems: { created: 0 },
      payments: { created: 0, skipped: 0, failed: 0 },
      openingBalanceApplied: 0,
    },
  };
}

describe('CustomerImportService.createInvoice — stock invariant', () => {
  let service: CustomerImportService;
  let tx: MockTx;

  // One batch holding 6 units; the invoice line below asks for 10.
  const makeTx = (batchQty: number): MockTx => ({
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 'cust-1', name: 'Acme' }) },
    invoice: {
      create: jest.fn().mockResolvedValue({ id: 'inv-new' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    invoiceItem: { create: jest.fn().mockResolvedValue({}) },
    batch: {
      findMany: jest.fn().mockResolvedValue(
        batchQty > 0
          ? [{ id: 'batch-1', batchNumber: 'B-1', quantity: batchQty, expiryDate: new Date('2030-01-01'), createdAt: new Date() }]
          : [],
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    product: {
      // resolveProductId looks the product up by name.
      findFirst: jest.fn().mockResolvedValue({ id: PRODUCT_ID }),
      findMany: jest.fn().mockResolvedValue([{ id: PRODUCT_ID, name: 'Paracetamol 500' }]),
      update: jest.fn().mockResolvedValue({}),
    },
  });

  const run = async (batchQty: number, qty = 10) => {
    tx = makeTx(batchQty);
    const prisma: any = {
      $transaction: jest.fn((cb: (t: MockTx) => unknown) => Promise.resolve(cb(tx))),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerImportService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: DocumentNumberingService,
          useValue: {
            nextNumber: jest.fn().mockResolvedValue('INV/26-27/00001'),
            retryOnCollision: jest.fn((op: () => unknown) => op()),
          },
        },
        { provide: PartyLinkService, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get<CustomerImportService>(CustomerImportService);

    const result = emptyResult();
    await (service as any).createInvoice(
      {
        sourceRow: 2,
        invoiceNumber: 'OLD-1',
        date: '2026-01-15',
        items: [{ productName: 'Paracetamol 500', quantity: qty, rate: 10, amount: 10 * qty }],
      },
      { customerCode: 'C1' },
      'cust-1',
      { userId: 'u1', branchId: null },
      result,
      new Map(),
    );
    return result;
  };

  const totalStockDelta = () => {
    const call = tx.product.update.mock.calls.find(
      (c: any[]) => c[0]?.data?.totalStock !== undefined,
    );
    return call ? call[0].data.totalStock : null;
  };

  it('decrements totalStock by what the batches actually supplied, not what was asked', async () => {
    const result = await run(6, 10); // 6 in stock, invoice wants 10

    // The batch gave everything it had.
    expect(tx.batch.update).toHaveBeenCalledTimes(1);
    expect(tx.batch.update.mock.calls[0][0].data).toEqual({ quantity: { decrement: 6 } });

    // ...and totalStock moved by the SAME 6 — not the requested 10. A 10 here
    // is the bug: it breaks totalStock === SUM(batch.quantity) by the shortfall.
    expect(totalStockDelta()).toEqual({ decrement: 6 });

    // The operator is told the sale couldn't be fully sourced.
    expect(JSON.stringify(result.warnings)).toMatch(/Only 6 of 10/);
  });

  it('decrements totalStock by the full quantity when stock covers it', async () => {
    await run(50, 10);

    expect(tx.batch.update.mock.calls[0][0].data).toEqual({ quantity: { decrement: 10 } });
    expect(totalStockDelta()).toEqual({ decrement: 10 });
  });

  it('leaves totalStock frozen when there are no batches at all', async () => {
    // This is the Stock-Tracking-OFF shape: nothing to draw from. The old code
    // still decremented totalStock by the full quantity, driving it negative
    // and violating the "frozen, not zeroed" guarantee of that mode.
    const result = await run(0, 10);

    expect(tx.batch.update).not.toHaveBeenCalled();
    expect(totalStockDelta()).toBeNull();
    expect(JSON.stringify(result.warnings)).toMatch(/Only 0 of 10/);
  });
});
