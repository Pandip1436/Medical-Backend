import { Test, TestingModule } from '@nestjs/testing';
import { GrnController } from './grn.controller';
import { GrnService } from './grn.service';

// Wiring smoke test — the service is an empty stub so nothing touches Postgres.
describe('GrnController', () => {
  let controller: GrnController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GrnController],
      providers: [{ provide: GrnService, useValue: {} }],
    }).compile();

    controller = module.get<GrnController>(GrnController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
