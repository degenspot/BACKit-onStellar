import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { Stake } from './entities/stake.entity';

const mockQb = {
  innerJoin: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  getRawOne: jest.fn(),
};

const mockStakeLedgerRepository = {
  createQueryBuilder: jest.fn(() => mockQb),
};

describe('AnalyticsService – getTotalValueLocked', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    // Reset call counts between tests without recreating the chain references
    jest.clearAllMocks();
    mockStakeLedgerRepository.createQueryBuilder.mockReturnValue(mockQb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: getRepositoryToken(Stake),
          useValue: mockStakeLedgerRepository,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('returns correct TVL and count when pending stakes exist', async () => {
    mockQb.getRawOne.mockResolvedValue({
      totalValueLocked: '1250.75',
      pendingStakesCount: '8',
    });

    const result = await service.getTotalValueLocked('GBXXX');

    expect(result).toEqual({
      userAddress: 'GBXXX',
      totalValueLocked: 1250.75,
      pendingStakesCount: 8,
    });

    // Assert the query was scoped correctly
    expect(mockQb.where).toHaveBeenCalledWith(
      'stake.userAddress = :userAddress',
      { userAddress: 'GBXXX' },
    );
    expect(mockQb.andWhere).toHaveBeenCalledWith('call.outcome = :outcome', {
      outcome: 'PENDING',
    });
  });

  it('returns zeros when the user has no pending stakes', async () => {
    // DB returns COALESCE default — still a string from getRawOne
    mockQb.getRawOne.mockResolvedValue({
      totalValueLocked: '0',
      pendingStakesCount: '0',
    });

    const result = await service.getTotalValueLocked('GBYYY');

    expect(result.totalValueLocked).toBe(0);
    expect(result.pendingStakesCount).toBe(0);
    expect(result.userAddress).toBe('GBYYY');
  });

  it('handles null getRawOne result gracefully', async () => {
    // Edge case: getRawOne can return undefined if the driver returns nothing
    mockQb.getRawOne.mockResolvedValue(undefined);

    const result = await service.getTotalValueLocked('GBZZZ');

    expect(result.totalValueLocked).toBe(0);
    expect(result.pendingStakesCount).toBe(0);
  });
});
