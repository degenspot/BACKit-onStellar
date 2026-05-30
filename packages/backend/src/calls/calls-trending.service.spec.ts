import { CallsTrendingService } from './calls-trending.service';

describe('CallsTrendingService', () => {
  describe('computeTrendingScore', () => {
    it('applies recency bonus for calls within 6 hours', () => {
      const service = new CallsTrendingService(
        {} as any,
        {} as any,
        { create: (v: any) => v, save: async () => [] } as any,
      );

      const now = new Date('2026-05-29T12:00:00.000Z');
      const createdAt = new Date('2026-05-29T12:00:00.000Z');

      const result = service.computeTrendingScore({
        stakeVolume24h: 10,
        stakerCount24h: 2,
        createdAt,
        now,
      });

      // numerator = 10*2 + 2*3 + 60 = 86, timeDecay = 1
      expect(result.recencyBonus).toBeCloseTo(60, 8);
      expect(result.timeDecay).toBeCloseTo(1, 8);
      expect(result.score).toBeCloseTo(86, 8);
    });

    it('decays score exponentially as calls age', () => {
      const service = new CallsTrendingService(
        {} as any,
        {} as any,
        { create: (v: any) => v, save: async () => [] } as any,
      );

      const now = new Date('2026-05-29T12:00:00.000Z');
      const createdAt = new Date('2026-05-29T00:00:00.000Z'); // 12 hours old

      const result = service.computeTrendingScore({
        stakeVolume24h: 10,
        stakerCount24h: 2,
        createdAt,
        now,
      });

      // numerator = 10*2 + 2*3 + 0 = 26
      expect(result.recencyBonus).toBeCloseTo(0, 8);
      expect(result.timeDecay).toBeCloseTo(Math.exp(0.5), 8);
      expect(result.score).toBeCloseTo(26 / Math.exp(0.5), 8);
    });
  });

  describe('recomputeAll', () => {
    it('stores a score row per visible call using 24h stake aggregates', async () => {
      const dataSource = {
        query: jest.fn().mockResolvedValue([
          { callId: 'c1', stakeVolume24h: '50', stakerCount24h: '4' },
        ]),
      };
      const callRepository = {
        find: jest.fn().mockResolvedValue([
          { id: 'c1', createdAt: new Date('2026-05-29T11:00:00.000Z') },
          { id: 'c2', createdAt: new Date('2026-05-29T01:00:00.000Z') },
        ]),
      };
      const trendingRepository = {
        create: (v: any) => v,
        save: jest.fn().mockResolvedValue([]),
      };

      const service = new CallsTrendingService(
        dataSource as any,
        callRepository as any,
        trendingRepository as any,
      );

      const now = new Date('2026-05-29T12:00:00.000Z');
      const result = await service.recomputeAll(now);

      expect(result.callsProcessed).toBe(2);
      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(trendingRepository.save).toHaveBeenCalledTimes(1);

      const savedRows = (trendingRepository.save as jest.Mock).mock.calls[0][0];
      expect(savedRows).toHaveLength(2);
      expect(savedRows[0].callId).toBe('c1');
      expect(savedRows[1].callId).toBe('c2');
    });
  });
});

