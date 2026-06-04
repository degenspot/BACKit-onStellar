import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TreasuryService } from './treasury.service';
import { TreasuryEntry } from './treasury-entry.entity';
import { ConfigService } from '../config/config.service';

describe('TreasuryService', () => {
  let service: TreasuryService;
  const repo = {
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
    createQueryBuilder: jest.fn(),
  };
  const configService = {
    getSettings: jest.fn().mockResolvedValue({ feePercent: 2.0 }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TreasuryService,
        { provide: getRepositoryToken(TreasuryEntry), useValue: repo },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(TreasuryService);
  });

  it('records fee entry derived from feePercent when override not provided', async () => {
    const entry = await service.recordFeeFromPayoutClaimed({
      callId: '00000000-0000-0000-0000-000000000000',
      claimedAmount: '100.0000000',
      collectedAt: new Date('2026-05-29T00:00:00.000Z'),
      tokenAddress: 'TOKEN',
    });

    expect(entry.feeAmount).toBe('2.0000000');
    expect(repo.save).toHaveBeenCalled();
  });
});
