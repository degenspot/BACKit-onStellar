import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { Stake } from './entities/stake.entity';
import { Call } from './entities/call.entity';
import { DataSource } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { TokensService } from '../token/tokens.service';
import { CoinGeckoService } from '../oracle/coinGeko.service';

const mockQb = {
  innerJoin: jest.fn().mockReturnThis(),
  innerJoinAndSelect: jest.fn().mockReturnThis(),
  leftJoin: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getRawOne: jest.fn(),
  getRawMany: jest.fn(),
  getMany: jest.fn(),
  getManyAndCount: jest.fn(),
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

const mockTokensService = {
  getAll: jest.fn(),
};

const mockCoinGeckoService = {
  getPrices: jest.fn(),
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
        {
          provide: TokensService,
          useValue: mockTokensService,
        },
        {
          provide: CoinGeckoService,
          useValue: mockCoinGeckoService,
        },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('returns correct TVL and count when pending stakes exist', async () => {
    mockQb.getMany.mockResolvedValue([
      {
        amount: '100',
        position: 'YES',
        call: {
          id: 'call-1',
          stakeToken: 'USDC-ADDR',
          totalYesStake: '200',
          totalNoStake: '100',
        },
      },
      {
        amount: '50',
        position: 'NO',
        call: {
          id: 'call-2',
          stakeToken: 'XLM-ADDR',
          totalYesStake: '50',
          totalNoStake: '50',
        },
      },
    ]);

    mockTokensService.getAll.mockResolvedValue([
      { assetIssuer: 'USDC-ADDR', assetCode: 'USDC' },
      { assetIssuer: 'XLM-ADDR', assetCode: 'XLM' },
    ]);

    const mockPrices = new Map<string, number>();
    mockPrices.set('USDC', 1);
    mockPrices.set('XLM', 0.1);
    mockCoinGeckoService.getPrices.mockResolvedValue(mockPrices);

    const result = await service.getTotalValueLocked('GBXXX');

    expect(result.userAddress).toEqual('GBXXX');
    expect(result.pendingStakesCount).toBe(2);
    expect(result.totalValueLocked).toBe(105); // 100*1 + 50*0.1 = 105

    expect(result.breakdown).toHaveLength(2);
    expect(result.breakdown[0].tokenSymbol).toBe('USDC');
    expect(result.breakdown[0].potentialWin).toBe(150); // (100 / 200) * 300 * 1
    expect(result.breakdown[1].tokenSymbol).toBe('XLM');
    expect(result.breakdown[1].potentialWin).toBe(10); // (50 / 50) * 100 * 0.1
  });

  it('returns zeros when the user has no pending stakes', async () => {
    mockQb.getMany.mockResolvedValue([]);

    const result = await service.getTotalValueLocked('GBYYY');

    expect(result.totalValueLocked).toBe(0);
    expect(result.pendingStakesCount).toBe(0);
    expect(result.userAddress).toBe('GBYYY');
    expect(result.breakdown).toEqual([]);
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
        {
          provide: TokensService,
          useValue: mockTokensService,
        },
        {
          provide: CoinGeckoService,
          useValue: mockCoinGeckoService,
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
