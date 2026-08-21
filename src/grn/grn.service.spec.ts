import { Test, TestingModule } from '@nestjs/testing';
import { GrnService } from './grn.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { ApprovalsService } from '../approvals/approvals.service';

// Wiring smoke test — proves the DI graph is satisfiable. Collaborators are
// stubbed rather than real: PrismaService connects to Postgres in its
// constructor.
//
// ApprovalsService is injected through a forwardRef (GrnService <-> Approvals-
// Service are mutually dependent), but the *token* is still the class itself,
// so a plain useValue provider satisfies it — no forwardRef needed on this side.
describe('GrnService', () => {
  let service: GrnService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrnService,
        { provide: PrismaService, useValue: {} },
        { provide: DocumentNumberingService, useValue: {} },
        { provide: ApprovalsService, useValue: {} },
      ],
    }).compile();

    service = module.get<GrnService>(GrnService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
