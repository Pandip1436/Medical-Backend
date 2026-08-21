import { ProductImportService } from './product-import.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ImportProductDto } from './dto/import-products.dto';

// Duplicate rule under test: a row is the same product as another only when
// BOTH its name and its item code match. Everything else — a shared code under
// two names, a shared name under two codes, blank optional fields, a repeated
// barcode — must still import, because dropping a row loses a real product.

const emptyPrisma = () =>
  ({
    product: { findMany: jest.fn().mockResolvedValue([]) },
  }) as unknown as PrismaService;

const row = (over: Partial<ImportProductDto>): ImportProductDto =>
  ({ sourceRow: 2, name: 'PRODUCT', ...over }) as ImportProductDto;

const preview = (service: ProductImportService, products: ImportProductDto[]) =>
  service.runImport(
    { products, duplicateHandling: 'UPDATE', dryRun: true },
    { userId: 'u1', branchId: 'b1' },
  );

describe('ProductImportService — duplicate detection', () => {
  let service: ProductImportService;

  beforeEach(() => {
    service = new ProductImportService(emptyPrisma(), { isStockTrackingEnabled: async () => true } as any);
  });

  it('treats same name + same code as one product', async () => {
    const res = await preview(service, [
      row({ sourceRow: 2, name: "NITREST 10MG TAB 10'S", productCode: '000211' }),
      row({ sourceRow: 3, name: "NITREST 10MG TAB 10'S", productCode: '000211' }),
    ]);

    expect(res.errors).toHaveLength(0);
    expect(res.summary.products.failed).toBe(0);
    expect(res.summary.products.created).toBe(1);
    expect(res.summary.products.skipped).toBe(1);
  });

  it('imports both rows when the code repeats under different names', async () => {
    const res = await preview(service, [
      row({ sourceRow: 2, name: 'ALPHA TAB', productCode: '000211' }),
      row({ sourceRow: 3, name: 'BETA INJ', productCode: '000211' }),
    ]);

    expect(res.errors).toHaveLength(0);
    expect(res.summary.products.failed).toBe(0);
    expect(res.summary.products.created).toBe(2);
  });

  it('imports both rows when the name repeats under different codes', async () => {
    const res = await preview(service, [
      row({ sourceRow: 2, name: "ABICLOR INJ 1'S", productCode: '1481' }),
      row({ sourceRow: 3, name: "ABICLOR INJ 1'S", productCode: '1615' }),
    ]);

    expect(res.errors).toHaveLength(0);
    expect(res.summary.products.created).toBe(2);
  });

  // The preview used to count a CREATE-strategy duplicate as "created", while
  // the commit path rejects it. The review screen promised a product that was
  // never going to exist.
  it('previews a CREATE-strategy duplicate as failed, matching the commit', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'p1',
          name: 'EXISTING TAB',
          barcode: null,
          productCode: null,
          branchId: 'b1',
        },
      ])
      .mockResolvedValue([]);
    const svc = new ProductImportService(
      { product: { findMany } } as unknown as PrismaService,
      { isStockTrackingEnabled: async () => true } as any,
    );

    const res = await svc.runImport(
      {
        products: [row({ name: 'EXISTING TAB' })],
        duplicateHandling: 'CREATE',
        dryRun: true,
      },
      { userId: 'u1', branchId: 'b1' },
    );

    expect(res.summary.products.created).toBe(0);
    expect(res.summary.products.failed).toBe(1);
    expect(res.errors[0].message).toContain('CREATE strategy refused');
  });

  it('still collapses a repeated name when neither row has a code', async () => {
    const res = await preview(service, [
      row({ sourceRow: 2, name: 'NO CODE ITEM' }),
      row({ sourceRow: 3, name: 'NO CODE ITEM' }),
    ]);

    expect(res.errors).toHaveLength(0);
    expect(res.summary.products.created).toBe(1);
    expect(res.summary.products.skipped).toBe(1);
  });
});

describe('ProductImportService — sparse rows', () => {
  let service: ProductImportService;

  beforeEach(() => {
    service = new ProductImportService(emptyPrisma(), { isStockTrackingEnabled: async () => true } as any);
  });

  it('imports a row carrying nothing but a name', async () => {
    const res = await preview(service, [row({ name: 'BARE PRODUCT' })]);

    expect(res.errors).toHaveLength(0);
    expect(res.summary.products.created).toBe(1);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('rejects only a row with no name at all', async () => {
    const res = await preview(service, [row({ name: '   ' })]);

    expect(res.summary.products.created).toBe(0);
    expect(res.summary.products.failed).toBe(1);
    expect(res.errors[0].field).toBe('name');
  });

  it('keeps the product and drops just the barcode when a barcode repeats', async () => {
    const res = await preview(service, [
      row({ sourceRow: 2, name: 'FIRST', productCode: 'A1', barcode: '8901' }),
      row({ sourceRow: 3, name: 'SECOND', productCode: 'A2', barcode: '8901' }),
    ]);

    expect(res.errors).toHaveLength(0);
    expect(res.summary.products.failed).toBe(0);
    expect(res.summary.products.created).toBe(2);
    expect(res.warnings.some((w) => w.field === 'barcode')).toBe(true);
  });
});

// The preview's pricing warning is the only place an operator can see what a
// blank price will do, so it has to describe the real outcome. buildCreateData
// falls back sellingRate → mrp → 0: a row with an MRP and no selling rate bills
// at MRP, which is a silent over-charge, not the "₹0" the old copy claimed.
describe('ProductImportService — pricing warnings', () => {
  let service: ProductImportService;

  const pricingWarning = (res: { warnings: { message: string }[] }) =>
    res.warnings.find((w) => w.message.startsWith('Pricing:'));

  beforeEach(() => {
    service = new ProductImportService(emptyPrisma(), { isStockTrackingEnabled: async () => true } as any);
  });

  // A row with every price supplied, so each test can blank exactly one field
  // and attribute the warning to it.
  const priced = (over: Partial<ImportProductDto>) =>
    row({
      name: 'PRICED',
      mrp: 100,
      purchaseRate: 70,
      sellingRate: 80,
      wholesaleRate: 75,
      gstRate: 12,
      ...over,
    });

  it('warns that a row with an MRP but no selling rate bills at MRP', async () => {
    const res = await preview(service, [
      priced({ name: 'MRP ONLY', sellingRate: undefined, mrp: 120 }),
    ]);

    const w = pricingWarning(res);
    expect(w?.message).toContain('will bill at the MRP (₹120.00)');
    expect(w?.message).not.toContain('bill at ₹0');
  });

  it('warns about ₹0 retail only when both selling rate and MRP are blank', async () => {
    const res = await preview(service, [
      priced({ name: 'NO PRICE', sellingRate: undefined, mrp: undefined }),
    ]);

    expect(pricingWarning(res)?.message).toContain(
      'retail sales will bill at ₹0',
    );
  });

  it('flags a selling rate below the purchase rate', async () => {
    const res = await preview(service, [
      priced({ name: 'LOSS MAKER', sellingRate: 70, purchaseRate: 80 }),
    ]);

    expect(pricingWarning(res)?.message).toContain(
      'retail rate ₹70.00 is below purchase_rate ₹80.00',
    );
  });

  // wholesaleRate falls back to purchaseRate, so a blank one prices every
  // wholesale line at exactly cost. That IS a real hazard, but the user chose
  // to silence it (14 Aug 2026) rather than carry a warning on all 2,723 rows.
  // Pinned as a test so the decision is deliberate, not a regression: flip
  // WARN_ON_MISSING_PRICE.wholesaleRate to bring it back.
  it('stays silent about a blank wholesale rate, by configuration', async () => {
    const res = await preview(service, [
      priced({ name: 'NO WHOLESALE', wholesaleRate: undefined }),
    ]);

    expect(pricingWarning(res)).toBeUndefined();
  });

  it('warns when purchase_rate is missing', async () => {
    const res = await preview(service, [
      priced({ name: 'NO COST', purchaseRate: undefined }),
    ]);

    expect(pricingWarning(res)?.message).toContain('no purchase_rate');
  });

  // The fields the user turned off must not reappear in any warning.
  it('says nothing about the fields configured as silent', async () => {
    const res = await preview(service, [
      row({
        name: 'BARE',
        mrp: 100,
        purchaseRate: 70,
        sellingRate: 80,
        gstRate: 12,
        saltComposition: 'X',
        hsnCode: '3004',
        categoryName: 'TABLETS',
      }),
    ]);

    const all = res.warnings.map((w) => w.message).join(' ');
    for (const f of [
      'generic_name',
      'manufacturer',
      'pack_size',
      'unit_of_measure',
      'rack_location',
      'wholesale_rate',
    ]) {
      expect(all).not.toContain(f);
    }
  });

  // A deliberate 0 reads as "supplied" to every ?? fallback, so it becomes a
  // real ₹0 price rather than being defaulted to anything.
  it('flags an explicitly-entered 0 rather than treating it as supplied', async () => {
    const res = await preview(service, [
      priced({ name: 'ZERO RATE', sellingRate: 0 }),
    ]);

    expect(pricingWarning(res)?.message).toContain(
      'selling_rate is 0 — retail sales will bill at ₹0',
    );
  });

  // Judged on the effective rate: the row supplies no selling rate, inherits
  // an MRP of 60, and that is below its own purchase rate of 80.
  it('catches below-cost when the losing rate is an inherited MRP', async () => {
    const res = await preview(service, [
      priced({
        name: 'INHERITED LOSS',
        sellingRate: undefined,
        mrp: 60,
        purchaseRate: 55,
        wholesaleRate: 50,
      }),
    ]);

    expect(pricingWarning(res)?.message).toContain(
      'wholesale rate ₹50.00 is below purchase_rate ₹55.00',
    );
  });

  it('stays quiet when the row is fully and sanely priced', async () => {
    const res = await preview(service, [priced({ name: 'GOOD PRICE' })]);

    expect(pricingWarning(res)).toBeUndefined();
  });

  it('does not warn about blank prices on an update — they leave the stored price alone', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'p1',
          name: 'EXISTING',
          barcode: null,
          productCode: null,
          branchId: 'b1',
        },
      ])
      .mockResolvedValue([]);
    const svc = new ProductImportService(
      { product: { findMany } } as unknown as PrismaService,
      { isStockTrackingEnabled: async () => true } as any,
    );

    const res = await preview(svc, [row({ name: 'EXISTING' })]);

    expect(res.summary.products.updated).toBe(1);
    expect(pricingWarning(res)).toBeUndefined();
  });
});

// Item codes are unique per branch. On the create path a contested code is
// dropped so the product still lands; the update path has to do the same, or
// the constraint fails the whole update and the row's price/HSN corrections
// are lost with it.
describe('ProductImportService — item code collision on update', () => {
  type Existing = {
    id: string;
    name: string;
    barcode: string | null;
    productCode: string | null;
    branchId: string | null;
  };

  const ALPHA: Existing = {
    id: 'p-alpha',
    name: 'ALPHA TAB',
    barcode: null,
    productCode: 'A1',
    branchId: 'b1',
  };
  const BETA: Existing = {
    id: 'p-beta',
    name: 'BETA INJ',
    barcode: null,
    productCode: null,
    branchId: 'b1',
  };

  const prismaWith = (existing: Existing[]) => {
    const update = jest.fn().mockResolvedValue({});
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(existing) // findExisting
      .mockResolvedValue([]); // findCrossBranchDuplicates
    return {
      prisma: {
        product: { findMany, update, create: jest.fn() },
        category: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService,
      update,
    };
  };

  const updateData = (update: jest.Mock): Record<string, unknown> =>
    (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;

  const commit = (service: ProductImportService, products: ImportProductDto[]) =>
    service.runImport(
      { products, duplicateHandling: 'UPDATE', dryRun: false },
      { userId: 'u1', branchId: 'b1' },
    );

  it("updates the product without stamping another product's code onto it", async () => {
    const { prisma, update } = prismaWith([ALPHA, BETA]);
    const service = new ProductImportService(prisma, { isStockTrackingEnabled: async () => true } as any);

    // BETA matches by name; the file gives it A1, which ALPHA already holds.
    const res = await commit(service, [
      row({ name: 'BETA INJ', productCode: 'A1', mrp: 90 }),
    ]);

    expect(res.errors).toHaveLength(0);
    expect(res.summary.products.updated).toBe(1);
    expect(res.warnings.some((w) => w.field === 'product_code')).toBe(true);

    const data = updateData(update);
    expect(data.productCode).toBeUndefined();
    expect(data.mrp).toBeDefined();
  });

  it('still writes a code that nothing else holds', async () => {
    const { prisma, update } = prismaWith([BETA]);
    const service = new ProductImportService(prisma, { isStockTrackingEnabled: async () => true } as any);

    const res = await commit(service, [
      row({ name: 'BETA INJ', productCode: 'B9' }),
    ]);

    expect(res.warnings.some((w) => w.field === 'product_code')).toBe(false);
    expect(updateData(update).productCode).toBe('B9');
  });
});
