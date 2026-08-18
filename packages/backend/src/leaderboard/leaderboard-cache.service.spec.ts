import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  LeaderboardCacheService,
  LeaderboardPeriod,
} from './leaderboard-cache.service';

// ─── ioredis mock ─────────────────────────────────────────────────────────────

const mockPipeline = {
  zadd: jest.fn().mockReturnThis(),
  del: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([]),
};

const mockRedis = {
  pipeline: jest.fn(() => mockPipeline),
  zadd: jest.fn().mockResolvedValue(1),
  zrevrange: jest.fn().mockResolvedValue([]),
  zrevrank: jest.fn().mockResolvedValue(null),
  zscore: jest.fn().mockResolvedValue(null),
  zcard: jest.fn().mockResolvedValue(0),
  ping: jest.fn().mockResolvedValue('PONG'),
  disconnect: jest.fn(),
  on: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedis);
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('LeaderboardCacheService', () => {
  let service: LeaderboardCacheService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardCacheService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('redis://localhost:6379'),
          },
        },
      ],
    }).compile();

    service = module.get<LeaderboardCacheService>(LeaderboardCacheService);
  });

  // ─── computeScore ──────────────────────────────────────────────────────────

  describe('computeScore()', () => {
    it('returns 0 when no calls', () => {
      expect(LeaderboardCacheService.computeScore(0, 0, 0)).toBe(0);
    });

    it('computes win_rate_bps * 1000 + profit component', () => {
      // 7 won / 10 total = 70% = 7000 bps
      // winRateBps = 7000  →  7000 * 1000 = 7_000_000
      // profitStroops = 5_000_000  →  floor(5_000_000 / 1_000_000) = 5
      const score = LeaderboardCacheService.computeScore(7, 10, 5_000_000);
      expect(score).toBe(7_000_000 + 5);
    });

    it('handles 100% win rate', () => {
      const score = LeaderboardCacheService.computeScore(5, 5, 0);
      // winRateBps = 10_000  →  10_000 * 1000 = 10_000_000
      expect(score).toBe(10_000_000);
    });

    it('handles zero totalCalls (avoids division by zero)', () => {
      const score = LeaderboardCacheService.computeScore(0, 0, 10_000_000);
      expect(score).toBe(10); // 0 * 1000 + floor(10_000_000/1_000_000)
    });

    it('floors profit component', () => {
      // 1_999_999 stroops → floor = 1
      const score = LeaderboardCacheService.computeScore(0, 1, 1_999_999);
      expect(score).toBe(1);
    });
  });

  // ─── keyFor ───────────────────────────────────────────────────────────────

  describe('keyFor()', () => {
    it.each<[LeaderboardPeriod, string]>([
      ['weekly', 'leaderboard:weekly'],
      ['monthly', 'leaderboard:monthly'],
      ['all_time', 'leaderboard:all_time'],
    ])('returns correct key for %s', (period, expected) => {
      expect(LeaderboardCacheService.keyFor(period)).toBe(expected);
    });
  });

  // ─── updateScore ──────────────────────────────────────────────────────────

  describe('updateScore()', () => {
    it('calls ZADD for all three period keys', async () => {
      await service.updateScore('GABCDEF', 7, 10, 5_000_000);

      expect(mockPipeline.zadd).toHaveBeenCalledTimes(3);
      expect(mockPipeline.zadd).toHaveBeenCalledWith(
        'leaderboard:weekly',
        expect.any(Number),
        'GABCDEF',
      );
      expect(mockPipeline.zadd).toHaveBeenCalledWith(
        'leaderboard:monthly',
        expect.any(Number),
        'GABCDEF',
      );
      expect(mockPipeline.zadd).toHaveBeenCalledWith(
        'leaderboard:all_time',
        expect.any(Number),
        'GABCDEF',
      );
      expect(mockPipeline.exec).toHaveBeenCalledTimes(1);
    });

    it('passes the correctly computed score to Redis', async () => {
      const expectedScore = LeaderboardCacheService.computeScore(
        7,
        10,
        5_000_000,
      );
      await service.updateScore('GABCDEF', 7, 10, 5_000_000);

      const zaddCall = (mockPipeline.zadd as jest.Mock).mock.calls.find(
        ([key]: [string]) => key === 'leaderboard:all_time',
      );
      expect(zaddCall[1]).toBe(expectedScore);
    });
  });

  // ─── bulkSet ──────────────────────────────────────────────────────────────

  describe('bulkSet()', () => {
    it('does nothing when entries array is empty', async () => {
      await service.bulkSet('weekly', []);
      expect(mockPipeline.del).not.toHaveBeenCalled();
    });

    it('DELetes old key then ZADDs new entries', async () => {
      const entries = [
        { address: 'GA', score: 100 },
        { address: 'GB', score: 200 },
      ];
      await service.bulkSet('all_time', entries);

      expect(mockPipeline.del).toHaveBeenCalledWith('leaderboard:all_time');
      expect(mockPipeline.zadd).toHaveBeenCalledTimes(1);
      expect(mockPipeline.exec).toHaveBeenCalledTimes(1);
    });
  });

  // ─── getTopEntries ────────────────────────────────────────────────────────

  describe('getTopEntries()', () => {
    it('returns parsed entries from ZREVRANGE WITHSCORES', async () => {
      mockRedis.zrevrange.mockResolvedValueOnce([
        'ADDR1',
        '5000',
        'ADDR2',
        '3000',
      ]);

      const result = await service.getTopEntries('weekly', 0, 2);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ address: 'ADDR1', score: 5000, rank: 1 });
      expect(result[1]).toEqual({ address: 'ADDR2', score: 3000, rank: 2 });
    });

    it('returns empty array when sorted set is empty', async () => {
      mockRedis.zrevrange.mockResolvedValueOnce([]);

      const result = await service.getTopEntries('weekly', 0, 10);
      expect(result).toEqual([]);
    });

    it('offsets rank by page offset', async () => {
      mockRedis.zrevrange.mockResolvedValueOnce(['ADDR21', '1000']);

      const result = await service.getTopEntries('all_time', 20, 1);
      expect(result[0].rank).toBe(21);
    });
  });

  // ─── getContextualRanking ─────────────────────────────────────────────────

  describe('getContextualRanking()', () => {
    it('returns null when address not in Redis', async () => {
      mockRedis.zrevrank.mockResolvedValueOnce(null);

      const result = await service.getContextualRanking('weekly', 'UNKNOWN');
      expect(result).toBeNull();
    });

    it('returns userEntry with 1-based rank', async () => {
      mockRedis.zrevrank.mockResolvedValueOnce(4); // 0-based rank = 4 → 1-based = 5
      mockRedis.zscore.mockResolvedValueOnce('8000');
      // above: positions 0-3
      mockRedis.zrevrange
        .mockResolvedValueOnce([
          'A',
          '9000',
          'B',
          '8500',
          'C',
          '8200',
          'D',
          '8100',
        ])
        // below: positions 5-9
        .mockResolvedValueOnce([
          'E',
          '7900',
          'F',
          '7800',
          'G',
          '7700',
          'H',
          '7600',
          'I',
          '7500',
        ]);

      const result = await service.getContextualRanking('weekly', 'TARGET');

      expect(result).not.toBeNull();
      expect(result!.userEntry.rank).toBe(5);
      expect(result!.userEntry.score).toBe(8000);
      expect(result!.above).toHaveLength(4);
      expect(result!.below).toHaveLength(5);
    });

    it('handles user at rank 1 (no above entries)', async () => {
      mockRedis.zrevrank.mockResolvedValueOnce(0);
      mockRedis.zscore.mockResolvedValueOnce('99999');
      // When zeroBasedRank=0, aboveStart=0, aboveEnd=-1 → condition (0 <= -1) is false
      // → NO zrevrange call for above
      // below: positions 1-5
      mockRedis.zrevrange.mockResolvedValueOnce(['B', '500', 'C', '400']);

      const result = await service.getContextualRanking('all_time', 'TOP');
      expect(result!.above).toEqual([]);
      expect(result!.below).toHaveLength(2);
    });
  });

  // ─── isHealthy ────────────────────────────────────────────────────────────

  describe('isHealthy()', () => {
    it('returns true when Redis responds PONG', async () => {
      mockRedis.ping.mockResolvedValueOnce('PONG');
      expect(await service.isHealthy()).toBe(true);
    });

    it('returns false when Redis throws', async () => {
      mockRedis.ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      expect(await service.isHealthy()).toBe(false);
    });
  });
});
