import { Test, TestingModule } from '@nestjs/testing';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

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
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(TreasuryController);
    jest.clearAllMocks();
  });

  it('delegates summary', async () => {
    service.getSummary.mockResolvedValue({ totalFees: '0', byToken: [] });
    await controller.getSummary({});
    expect(service.getSummary).toHaveBeenCalled();
  });
});
