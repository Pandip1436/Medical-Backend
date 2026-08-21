import { Test, TestingModule } from '@nestjs/testing';
import { SupplierImportService } from './supplier-import.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { PartyLinkService } from '../party-link/party-link.service';

// ─────────────────────────────────────────────────────────────
// Guards the core inventory invariant on the Batches import sheet:
//
//     Product.totalStock === SUM(batch.quantity)
//
// This sheet's most valuable job is bulk-loading OPENING STOCK when an
// operator switches Stock Tracking on. It used to create the Batch row and
// nothing else, which inverted the invariant instead of breaking loudly:
// batches held stock while totalStock stayed 0, so every product read
// "Out of Stock", reconcileProductBatches trimmed the Batches tab down to
// zero, low-stock alerts fired for the whole catalogue, and the first sale
// drove totalStock negative.
//
// GrnService does the create + increment together in one transaction; these
// tests pin this path to the same contract.
// ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mock<T = any> = jest.Mock<Promise<T>, any[]>;

interface MockTx {
  batch: { create: Mock };
  product: { update: Mock };
}

function emptyResult(): any {
  return {
    errors: [],
    warnings: [],
    summary: {
      suppliers: { created: 0, updated: 0, skipped: 0, failed: 0 },
      batches: { created: 0, skipped: 0, failed: 0 },
      documents: { created: 0, skipped: 0, failed: 0 },
      openingBalanceApplied: 0,
    },
  };
}

describe('SupplierImportService.createBatch — opening-stock invariant', () => {
  let service: SupplierImportService;
  let tx: MockTx;
  let prisma: any;

  const PRODUCT_ID = 'prod-A';
  const SUPPLIER_ID = 'sup-1';

  const batchRow = (over: Record<string, unknown> = {}) => ({
    sourceRow: 2,
    productId: PRODUCT_ID,
    batchNumber: 'B-OPEN-1',
    quantity: 250,
    mrp: 120,
    purchaseRate: 70,
    expiryDate: '2030-01-31',
    ...over,
  });

  const run = (over: Record<string, unknown> = {}) => {
    const result = emptyResult();
    return (service as any)
      .createBatch(batchRow(over), { supplierCode: 'S1' }, SUPPLIER_ID, { userId: 'u1', branchId: null }, result)
      .then(() => result);
  };

  beforeEach(async () => {
    tx = {
      batch: { create: jest.fn().mockResolvedValue({ id: 'batch-new' }) },
      product: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      // The row carries a product_id, so createBatch verifies it by id first
      // (findUnique) and only falls back to a name lookup (findFirst) if that
      // misses or belongs to another branch. branchId null = global, in scope.
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: PRODUCT_ID, branchId: null }),
        findFirst: jest.fn().mockResolvedValue({ id: PRODUCT_ID }),
      },
      // No duplicate batch for this supplier+product → reaches the create.
      batch: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((cb: (t: MockTx) => unknown) => Promise.resolve(cb(tx))),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: DocumentNumberingService, useValue: { nextNumber: jest.fn(), retryOnCollision: jest.fn((op: () => unknown) => op()) } },
        { provide: PartyLinkService, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get<SupplierImportService>(SupplierImportService);
  });

  it('carries the imported quantity onto Product.totalStock', async () => {
    const result = await run();

    expect(tx.batch.create).toHaveBeenCalledTimes(1);
    expect(tx.batch.create.mock.calls[0][0].data.quantity).toBe(250);

    // The whole point: stock landed on the product too, not just the batch.
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    const upd = tx.product.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: PRODUCT_ID });
    expect(upd.data).toEqual({ totalStock: { increment: 250 } });

    expect(result.summary.batches.created).toBe(1);
  });

  it('does both writes inside ONE transaction', async () => {
    await run();
    // A batch row created without its matching totalStock bump — or vice versa —
    // is exactly the corruption this guards, so the two must not be separable.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('leaves totalStock alone for a zero-quantity batch', async () => {
    // A placeholder row, or stock already sold through, is a legitimate import
    // and must not nudge the running total.
    await run({ quantity: 0 });

    expect(tx.batch.create).toHaveBeenCalledTimes(1);
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('writes nothing when the batch already exists for this supplier+product', async () => {
    prisma.batch.findFirst.mockResolvedValue({ id: 'batch-existing' });

    const result = await run();

    // Skipping must skip BOTH writes — incrementing totalStock for a batch we
    // didn't create would inflate stock on every re-import of the same sheet.
    expect(tx.batch.create).not.toHaveBeenCalled();
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(result.summary.batches.skipped).toBe(1);
  });
});
