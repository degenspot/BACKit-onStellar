import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { Stake } from './entities/stake.entity';
import { Call } from './entities/call.entity';
import { DataSource } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

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

const mockCallRepository = {
  createQueryBuilder: jest.fn(() => mockQb),
};

const mockDataSource = {
  query: jest.fn(),
};

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
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
        {
          provide: getRepositoryToken(Call),
          useValue: mockCallRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
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

describe('AnalyticsService - calculateReputationScore', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockStakeLedgerRepository.createQueryBuilder.mockReturnValue(mockQb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: getRepositoryToken(Stake),
          useValue: mockStakeLedgerRepository,
        },
        {
          provide: getRepositoryToken(Call),
          useValue: mockCallRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('returns low score for a new user', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{ resolved_calls: 0, wins: 0, total_volume: 0 }])
      .mockResolvedValueOnce([{ median_volume: 1000 }])
      .mockResolvedValueOnce([]);

    const score = await service.calculateReputationScore('NEW_USER');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(15);
  });

  it('rewards whale user volume but caps normalization', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([
        { resolved_calls: 12, wins: 8, total_volume: 50000 },
      ])
      .mockResolvedValueOnce([{ median_volume: 500 }])
      .mockResolvedValueOnce([
        { week_start: '2026-01-01' },
        { week_start: '2026-01-08' },
        { week_start: '2026-01-15' },
      ]);

    const score = await service.calculateReputationScore('WHALE_USER');
    expect(score).toBeGreaterThan(55);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('rewards consistent predictor activity streaks', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([
        { resolved_calls: 15, wins: 10, total_volume: 4000 },
      ])
      .mockResolvedValueOnce([{ median_volume: 2000 }])
      .mockResolvedValueOnce([
        { week_start: '2026-02-01' },
        { week_start: '2026-02-08' },
        { week_start: '2026-02-15' },
        { week_start: '2026-02-22' },
        { week_start: '2026-03-01' },
        { week_start: '2026-03-08' },
      ]);

    const score = await service.calculateReputationScore('CONSISTENT_USER');
    expect(score).toBeGreaterThan(60);
  });
});
