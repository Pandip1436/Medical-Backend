import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';

// Wiring smoke test. ProductsService takes three collaborators; the Nest CLI
// stub this file grew from listed none of them, so compile() threw before a
// single assertion ran. Each is stubbed rather than instantiated — the real
// PrismaService opens a database connection at construction, which a unit test
// must never do.
describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: {} },
        { provide: ApprovalsService, useValue: {} },
        { provide: DocumentNumberingService, useValue: {} },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
