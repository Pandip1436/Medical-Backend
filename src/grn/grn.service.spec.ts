import { Test, TestingModule } from '@nestjs/testing';
import { GrnService } from './grn.service';

describe('GrnService', () => {
  let service: GrnService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GrnService],
    }).compile();

    service = module.get<GrnService>(GrnService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
