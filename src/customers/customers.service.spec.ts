import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from './customers.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { PartyLinkService } from '../party-link/party-link.service';

// Wiring smoke test — proves the DI graph is satisfiable. Collaborators are
// stubbed rather than real: PrismaService connects to Postgres in its
// constructor, and the other two would drag their own graphs in with them.
describe('CustomersService', () => {
  let service: CustomersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: {} },
        { provide: ApprovalsService, useValue: {} },
        { provide: PartyLinkService, useValue: {} },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
