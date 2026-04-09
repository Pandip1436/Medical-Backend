import { Test, TestingModule } from '@nestjs/testing';
import { GrnController } from './grn.controller';

describe('GrnController', () => {
  let controller: GrnController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GrnController],
    }).compile();

    controller = module.get<GrnController>(GrnController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
