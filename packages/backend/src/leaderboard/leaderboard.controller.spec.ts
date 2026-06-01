import { Test, TestingModule } from '@nestjs/testing';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';
import {
  LeaderboardQueryDto,
  LeaderboardResponseDto,
  UserLeaderboardStatsDto,
  LeaderboardSort,
  LeaderboardTimeframe,
} from './leaderboard.dto';

const mockLeaderboardResponse: LeaderboardResponseDto = {
  data: [
    {
      rank: 1,
      userId: 'user-1',
      username: 'Alice',
      avatarUrl: null,
      totalCalls: 10,
      wonCalls: 7,
      lostCalls: 3,
      winRate: 70,
      totalProfit: 150.5,
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  pages: 1,
  sort: LeaderboardSort.PROFIT,
  timeframe: LeaderboardTimeframe.ALL,
  generatedAt: new Date(),
};

const mockUserStats: UserLeaderboardStatsDto = {
  userId: 'user-1',
  rank: 1,
  totalCalls: 10,
  wonCalls: 7,
  lostCalls: 3,
  winRate: 70,
  totalProfit: 150.5,
  qualifiesForWinRate: true,
};

describe('LeaderboardController', () => {
  let controller: LeaderboardController;
  let service: jest.Mocked<LeaderboardService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeaderboardController],
      providers: [
        {
          provide: LeaderboardService,
          useValue: {
            getLeaderboard: jest
              .fn()
              .mockResolvedValue(mockLeaderboardResponse),
            getUserStats: jest.fn().mockResolvedValue(mockUserStats),
          },
        },
      ],
    }).compile();

    controller = module.get<LeaderboardController>(LeaderboardController);
    service = module.get(LeaderboardService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('GET /leaderboard', () => {
    it('delegates to service.getLeaderboard with query', async () => {
      const query: LeaderboardQueryDto = {
        sort: LeaderboardSort.PROFIT,
        timeframe: LeaderboardTimeframe.ALL,
        page: 1,
        limit: 20,
      };

      const result = await controller.getLeaderboard(query);

      expect(service.getLeaderboard).toHaveBeenCalledWith(query);
      expect(result).toBe(mockLeaderboardResponse);
    });

    it('passes winrate sort query to service', async () => {
      const query: LeaderboardQueryDto = {
        sort: LeaderboardSort.WINRATE,
        timeframe: LeaderboardTimeframe.MONTH,
        page: 1,
        limit: 10,
      };

      await controller.getLeaderboard(query);

      expect(service.getLeaderboard).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: LeaderboardSort.WINRATE,
          timeframe: LeaderboardTimeframe.MONTH,
        }),
      );
    });

    it('returns empty response gracefully', async () => {
      const empty: LeaderboardResponseDto = {
        ...mockLeaderboardResponse,
        data: [],
        total: 0,
        pages: 0,
      };
      service.getLeaderboard.mockResolvedValue(empty);

      const result = await controller.getLeaderboard({
        sort: LeaderboardSort.PROFIT,
        timeframe: LeaderboardTimeframe.ALL,
        page: 1,
        limit: 20,
      });

      expect(result.data).toHaveLength(0);
    });
  });

  describe('GET /leaderboard/users/:userId', () => {
    it('delegates to service.getUserStats with userId', async () => {
      const userId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

      const result = await controller.getUserStats(userId);

      expect(service.getUserStats).toHaveBeenCalledWith(userId);
      expect(result).toBe(mockUserStats);
    });

    it('returns stats with qualifiesForWinRate flag', async () => {
      service.getUserStats.mockResolvedValue({
        ...mockUserStats,
        totalCalls: 3,
        qualifiesForWinRate: false,
      });

      const result = await controller.getUserStats('some-uuid');

      expect(result.qualifiesForWinRate).toBe(false);
    });
  });
});
