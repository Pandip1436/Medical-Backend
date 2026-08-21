import { Test, TestingModule } from '@nestjs/testing';
import { ReportsService } from './reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { SettingsService } from '../settings/settings.service';

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: {} },
        { provide: CustomersService, useValue: { computeLiveOutstanding: jest.fn() } },
        // Stock Tracking gates the low-stock / near-expiry dashboard figures.
        // Stubbed ON: these specs cover GST rounding, which is unrelated, and ON
        // keeps those computations on their normal path.
        {
          provide: SettingsService,
          useValue: { isStockTrackingEnabled: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('GSTR-1 export precision', () => {
    // Regression for Phase-7 SEV-2: the GSTR-1 aggregation re-computes taxable
    // as `amount / (1 + rate/100)` which produces IEEE-754 noise like
    // `71472.92857142857`. The export must never serialize more than 2 decimals
    // for any numeric value or it leaks into accountants' .csv files.
    //
    // Walk numeric values only — ignore strings (ISO dates carry `.000Z`).
    const collectNumbers = (v: any, acc: number[] = []): number[] => {
      if (typeof v === 'number') acc.push(v);
      else if (Array.isArray(v)) v.forEach((x) => collectNumbers(x, acc));
      else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectNumbers(x, acc));
      return acc;
    };
    const longDecimals = (resp: any) =>
      collectNumbers(resp).filter((n) => /\d\.\d{3,}/.test(String(n)));

    it('roundCurrency clamps division noise to 2 decimals', () => {
      const r = (service as any).roundCurrency.bind(service);
      // 80000 / 1.12 = 71428.57142857... — the classic GSTR-1 leak shape
      expect(r(80000 / 1.12)).toBe(71428.57);
      // tax = taxable * 12 / 200
      expect(r((71428.57142857 * 12) / 200)).toBe(4285.71);
      // already-clean values stay clean
      expect(r(100)).toBe(100);
      expect(r(0)).toBe(0);
      // round-half-up at the boundary
      expect(r(1.005)).toBe(1.01);
    });

    it('getGstr1Summary response has no values with 3+ decimals', async () => {
      // Two invoices in the 12% slab + one in the 18% slab — values chosen so
      // the division produces non-terminating decimals (the exact case from
      // the playtest .csv).
      const invoices = [
        {
          items: [
            { gstPercent: 12, amount: 40000 },
            { gstPercent: 12, amount: 40000 },
          ],
        },
        { items: [{ gstPercent: 18, amount: 19000 }] },
      ];
      const findManyInv = jest.fn().mockResolvedValue(invoices);
      const findManyCN = jest.fn().mockResolvedValue([{ totalAmount: 554.33333 }]);
      (service as any).prisma = {
        invoice: { findMany: findManyInv },
        creditNote: { findMany: findManyCN },
      };

      const res = await service.getGstr1Summary({});
      expect(longDecimals(res)).toEqual([]);

      // And the math still reconciles to within rounding tolerance.
      const r12 = res.tableData.find((r) => r.gstRate === 12)!;
      expect(r12.taxable).toBeCloseTo(80000 / 1.12, 1);
      expect(r12.cgst).toBeCloseTo((80000 / 1.12 * 12) / 200, 1);
    });

    it('getHsnSummary response has no values with 3+ decimals', async () => {
      const items = [
        { productId: 'p1', gstPercent: 12, amount: 40000, quantity: 1 },
        { productId: 'p2', gstPercent: 18, amount: 19000, quantity: 1 },
      ];
      const products = [
        { id: 'p1', hsnCode: '3004', unitOfMeasure: 'NOS' },
        { id: 'p2', hsnCode: '3005', unitOfMeasure: 'NOS' },
      ];
      (service as any).prisma = {
        invoiceItem: { findMany: jest.fn().mockResolvedValue(items) },
        product: { findMany: jest.fn().mockResolvedValue(products) },
      };

      const res = await service.getHsnSummary({});
      expect(longDecimals(res)).toEqual([]);
    });
  });
});
