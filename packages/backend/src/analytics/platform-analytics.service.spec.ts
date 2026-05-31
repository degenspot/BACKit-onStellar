import { AnalyticsService } from './analytics.service';
import { DataSource } from 'typeorm';

const mockCallRepo = { createQueryBuilder: jest.fn() } as any;
const mockStakeRepo = { createQueryBuilder: jest.fn() } as any;
const mockDataSource = {
  query: jest.fn(),
} as unknown as DataSource;

describe('AnalyticsService – platform analytics', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnalyticsService(mockCallRepo, mockStakeRepo, mockDataSource);
  });

  describe('getPlatformAnalytics', () => {
    it('returns aggregated platform stats', async () => {
      (mockDataSource.query as jest.Mock)
        .mockResolvedValueOnce([{ total_calls_created: '10', total_calls_resolved: '5', avg_call_duration_hours: '2' }])
        .mockResolvedValueOnce([{ total_stake_volume: '1000', total_unique_users: '50' }])
        .mockResolvedValueOnce([{ total_unique_users: '50' }])
        .mockResolvedValueOnce([]);

      const result = await service.getPlatformAnalytics();
      expect(result.totalCallsCreated).toBe(10);
      expect(result.totalCallsResolved).toBe(5);
      expect(result.totalStakeVolume).toBe(1000);
      expect(result.totalUniqueUsers).toBe(50);
    });

    it('returns cached result on second call', async () => {
      (mockDataSource.query as jest.Mock)
        .mockResolvedValue([{ total_calls_created: '1', total_calls_resolved: '0', avg_call_duration_hours: '0', total_stake_volume: '0', total_unique_users: '0' }]);

      await service.getPlatformAnalytics();
      await service.getPlatformAnalytics();
      // dataSource.query called 4 times on first call (4 parallel queries), 0 on second (cached)
      expect((mockDataSource.query as jest.Mock).mock.calls.length).toBe(4);
    });
  });

  describe('getPlatformTrends', () => {
    it('returns trend data points', async () => {
      (mockDataSource.query as jest.Mock).mockResolvedValue([]);
      const result = await service.getPlatformTrends('7d');
      expect(result.period).toBe('7d');
      expect(Array.isArray(result.dataPoints)).toBe(true);
    });
  });
});
