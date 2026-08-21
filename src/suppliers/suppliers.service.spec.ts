import { Test, TestingModule } from '@nestjs/testing';
import { SuppliersService } from './suppliers.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../common/services/document-numbering.service';
import { PartyLinkService } from '../party-link/party-link.service';
import { ApprovalsService } from '../approvals/approvals.service';

// Wiring smoke test — proves the DI graph is satisfiable. Collaborators are
// stubbed rather than real: PrismaService connects to Postgres in its
// constructor.
//
// ApprovalsService is injected through a forwardRef, but the token is still the
// class itself, so a plain useValue provider satisfies it.
describe('SuppliersService', () => {
  let service: SuppliersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: {} },
        { provide: DocumentNumberingService, useValue: {} },
        { provide: PartyLinkService, useValue: {} },
        { provide: ApprovalsService, useValue: {} },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
