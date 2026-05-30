import { Test, TestingModule } from '@nestjs/testing';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';

describe('TreasuryController', () => {
  let controller: TreasuryController;
  const service = {
    getSummary: jest.fn(),
    getHistory: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TreasuryController],
      providers: [{ provide: TreasuryService, useValue: service }],
    }).compile();

    controller = module.get(TreasuryController);
    jest.clearAllMocks();
  });

  it('delegates summary', async () => {
    service.getSummary.mockResolvedValue({ totalFees: '0', byToken: [] });
    await controller.getSummary({} as any);
    expect(service.getSummary).toHaveBeenCalled();
  });
});

