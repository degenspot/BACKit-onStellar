import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { LeaderboardSyncService } from './leaderboard-sync.service';
import { LeaderboardCacheService } from './leaderboard-cache.service';

function makeQb(rows: any[]) {
  const qb: Partial<SelectQueryBuilder<any>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
    getRawOne: jest.fn().mockResolvedValue({}),
  };
  return qb as jest.Mocked<SelectQueryBuilder<any>>;
}

describe('LeaderboardSyncService', () => {
  let service: LeaderboardSyncService;
  let cacheService: jest.Mocked<LeaderboardCacheService>;
  let dataSource: jest.Mocked<DataSource>;
  let qbMock: jest.Mocked<SelectQueryBuilder<any>>;

  const mockRows = [
    {
      userId: 'USER1',
      totalCalls: '10',
      wonCalls: '7',
      totalProfitUsdc: '100',
    },
    { userId: 'USER2', totalCalls: '5', wonCalls: '2', totalProfitUsdc: '50' },
  ];

  beforeEach(async () => {
    qbMock = makeQb(mockRows) as any;

    dataSource = {
      createQueryBuilder: jest.fn().mockReturnValue(qbMock),
    } as any;

    cacheService = {
      bulkSet: jest.fn().mockResolvedValue(undefined),
      computeScore: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardSyncService,
        { provide: LeaderboardCacheService, useValue: cacheService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<LeaderboardSyncService>(LeaderboardSyncService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('syncPeriod()', () => {
    it('calls bulkSet with computed entries for all_time (no date filter)', async () => {
      await service.syncPeriod('all_time', null);

      expect(qbMock.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('settledAt'),
        expect.anything(),
      );
      expect(cacheService.bulkSet).toHaveBeenCalledWith(
        'all_time',
        expect.arrayContaining([
          expect.objectContaining({ address: 'USER1' }),
          expect.objectContaining({ address: 'USER2' }),
        ]),
      );
    });

    it('applies date filter for weekly/monthly periods', async () => {
      const since = new Date('2026-08-10T00:00:00Z');
      await service.syncPeriod('weekly', since);

      expect(qbMock.andWhere).toHaveBeenCalledWith('pc.settledAt >= :since', {
        since,
      });
    });

    it('passes correct score computed from rows to bulkSet', async () => {
      await service.syncPeriod('all_time', null);

      const callArg = (cacheService.bulkSet as jest.Mock).mock
        .calls[0][1] as Array<{ address: string; score: number }>;
      // USER1: 7/10 wins = 7000 bps → 7000*1000 = 7_000_000; profit = 100 * 1e6 = 1e8 → /1e6 = 100
      const user1 = callArg.find((e) => e.address === 'USER1')!;
      expect(user1.score).toBe(
        LeaderboardCacheService.computeScore(7, 10, 100_000_000),
      );
    });

    it('throws and logs on DB error', async () => {
      qbMock.getRawMany.mockRejectedValueOnce(new Error('DB down'));
      await expect(service.syncPeriod('all_time', null)).rejects.toThrow(
        'DB down',
      );
    });

    it('handles empty result gracefully', async () => {
      qbMock.getRawMany.mockResolvedValueOnce([]);
      await service.syncPeriod('monthly', null);
      expect(cacheService.bulkSet).toHaveBeenCalledWith('monthly', []);
    });
  });
});
