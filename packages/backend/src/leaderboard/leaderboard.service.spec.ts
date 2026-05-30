import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { LeaderboardService } from './leaderboard.service';
import {
  PredictionCall,
  LeaderboardSnapshot,
  CallStatus,
  CallOutcome,
} from './entities/leaderboard.entity';
import {
  LeaderboardQueryDto,
  LeaderboardSort,
  LeaderboardTimeframe,
} from './dto/leaderboard.dto';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRawRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    userId: 'user-1',
    username: 'Alice',
    avatarUrl: null,
    totalCalls: '10',
    wonCalls: '7',
    lostCalls: '3',
    winRate: '70.00',
    totalProfit: '150.50',
    ...overrides,
  };
}

function buildQbMock(rawRows: any[], count = rawRows.length) {
  const qb: Partial<SelectQueryBuilder<any>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    having: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rawRows),
    getRawOne: jest
      .fn()
      .mockResolvedValue({ count: String(count), rank: '2', ...rawRows[0] }),
  };
  return qb as jest.Mocked<SelectQueryBuilder<any>>;
}

// ── test suite ────────────────────────────────────────────────────────────────

describe('LeaderboardService', () => {
  let service: LeaderboardService;
  let dataSourceMock: jest.Mocked<DataSource>;
  let qbMock: jest.Mocked<SelectQueryBuilder<any>>;

  beforeEach(async () => {
    qbMock = buildQbMock([makeRawRow()]) as any;

    dataSourceMock = {
      createQueryBuilder: jest.fn().mockReturnValue(qbMock),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        {
          provide: getRepositoryToken(PredictionCall),
          useValue: { createQueryBuilder: jest.fn() },
        },
        {
          provide: getRepositoryToken(LeaderboardSnapshot),
          useValue: {},
        },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();

    service = module.get<LeaderboardService>(LeaderboardService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── getLeaderboard ──────────────────────────────────────────────────────────

  describe('getLeaderboard()', () => {
    const baseQuery: LeaderboardQueryDto = {
      sort: LeaderboardSort.PROFIT,
      timeframe: LeaderboardTimeframe.ALL,
      page: 1,
      limit: 20,
    };

    it('returns formatted leaderboard data', async () => {
      const result = await service.getLeaderboard(baseQuery);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        rank: 1,
        userId: 'user-1',
        totalCalls: 10,
        wonCalls: 7,
        lostCalls: 3,
        winRate: 70,
        totalProfit: 150.5,
      });
    });

    it('sets correct pagination meta', async () => {
      // Simulate 45 total users across pages
      qbMock.getRawMany.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) =>
          makeRawRow({ userId: `user-${i}` }),
        ),
      );
      qbMock.getRawOne.mockResolvedValue({ count: '45' });

      const result = await service.getLeaderboard({ ...baseQuery, page: 2 });

      expect(result.page).toBe(2);
      expect(result.total).toBe(45);
      expect(result.pages).toBe(3);
    });

    it('returns empty response when no data', async () => {
      qbMock.getRawMany.mockResolvedValue([]);
      qbMock.getRawOne.mockResolvedValue({ count: '0' });

      const result = await service.getLeaderboard(baseQuery);

      expect(result.data).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.pages).toBe(0);
    });

    it('applies WINRATE sort with having clause (min 5 calls)', async () => {
      await service.getLeaderboard({
        ...baseQuery,
        sort: LeaderboardSort.WINRATE,
      });

      expect(qbMock.having).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        {
          minCalls: 5,
        },
      );
      expect(qbMock.orderBy).toHaveBeenCalledWith('winRate', 'DESC');
    });

    it('applies PROFIT sort without having clause', async () => {
      await service.getLeaderboard({
        ...baseQuery,
        sort: LeaderboardSort.PROFIT,
      });

      expect(qbMock.having).not.toHaveBeenCalled();
      expect(qbMock.orderBy).toHaveBeenCalledWith('totalProfit', 'DESC');
    });

    it('applies month date filter when timeframe=month', async () => {
      await service.getLeaderboard({
        ...baseQuery,
        timeframe: LeaderboardTimeframe.MONTH,
      });

      expect(qbMock.andWhere).toHaveBeenCalledWith('pc.settledAt >= :since', {
        since: expect.any(Date),
      });
    });

    it('does not apply date filter when timeframe=all', async () => {
      await service.getLeaderboard({
        ...baseQuery,
        timeframe: LeaderboardTimeframe.ALL,
      });

      const andWhereCalls = (qbMock.andWhere as jest.Mock).mock.calls;
      const hasDateFilter = andWhereCalls.some(([q]) =>
        q.includes('settledAt'),
      );
      expect(hasDateFilter).toBe(false);
    });

    it('always filters by SETTLED status', async () => {
      await service.getLeaderboard(baseQuery);

      expect(qbMock.where).toHaveBeenCalledWith('pc.status = :status', {
        status: CallStatus.SETTLED,
      });
    });

    it('ranks start at (page-1)*limit + 1 for page 2', async () => {
      qbMock.getRawMany.mockResolvedValue([
        makeRawRow({ userId: 'user-21' }),
        makeRawRow({ userId: 'user-22' }),
      ]);
      qbMock.getRawOne.mockResolvedValue({ count: '50' });

      const result = await service.getLeaderboard({
        ...baseQuery,
        page: 2,
        limit: 20,
      });

      expect(result.data[0].rank).toBe(21);
      expect(result.data[1].rank).toBe(22);
    });

    it('attaches generatedAt timestamp', async () => {
      const before = new Date();
      const result = await service.getLeaderboard(baseQuery);
      const after = new Date();

      expect(result.generatedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(result.generatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('handles null username gracefully', async () => {
      qbMock.getRawMany.mockResolvedValue([
        makeRawRow({ username: null, userId: 'abc-12345678' }),
      ]);

      const result = await service.getLeaderboard(baseQuery);

      expect(result.data[0].username).toContain('User');
    });
  });

  // ── getUserStats ────────────────────────────────────────────────────────────

  describe('getUserStats()', () => {
    const userId = 'test-user-uuid';

    it('returns stats with correct numeric conversions', async () => {
      qbMock.getRawOne
        .mockResolvedValueOnce({
          totalCalls: '10',
          wonCalls: '7',
          lostCalls: '3',
          winRate: '70.00',
          totalProfit: '150.50',
        })
        .mockResolvedValueOnce({ rank: '2' });

      const result = await service.getUserStats(userId);

      expect(result).toMatchObject({
        userId,
        rank: 3, // rank = result.rank + 1
        totalCalls: 10,
        wonCalls: 7,
        lostCalls: 3,
        winRate: 70,
        totalProfit: 150.5,
        qualifiesForWinRate: true,
      });
    });

    it('returns null rank when user has no calls', async () => {
      qbMock.getRawOne
        .mockResolvedValueOnce({
          totalCalls: '0',
          wonCalls: '0',
          lostCalls: '0',
          winRate: '0',
          totalProfit: '0',
        })
        .mockResolvedValueOnce({ rank: '0' });

      const result = await service.getUserStats(userId);

      expect(result.rank).toBeNull();
      expect(result.totalCalls).toBe(0);
    });

    it('sets qualifiesForWinRate=false when < 5 calls', async () => {
      qbMock.getRawOne
        .mockResolvedValueOnce({
          totalCalls: '4',
          wonCalls: '4',
          lostCalls: '0',
          winRate: '100.00',
          totalProfit: '50.00',
        })
        .mockResolvedValueOnce({ rank: '0' });

      const result = await service.getUserStats(userId);

      expect(result.qualifiesForWinRate).toBe(false);
    });

    it('sets qualifiesForWinRate=true when exactly 5 calls', async () => {
      qbMock.getRawOne
        .mockResolvedValueOnce({
          totalCalls: '5',
          wonCalls: '3',
          lostCalls: '2',
          winRate: '60.00',
          totalProfit: '20.00',
        })
        .mockResolvedValueOnce({ rank: '5' });

      const result = await service.getUserStats(userId);

      expect(result.qualifiesForWinRate).toBe(true);
    });

    it('handles null / missing profit gracefully (COALESCE)', async () => {
      qbMock.getRawOne
        .mockResolvedValueOnce({
          totalCalls: '3',
          wonCalls: '2',
          lostCalls: '1',
          winRate: null,
          totalProfit: null,
        })
        .mockResolvedValueOnce({ rank: '0' });

      const result = await service.getUserStats(userId);

      expect(result.winRate).toBe(0);
      expect(result.totalProfit).toBe(0);
    });
  });
});
