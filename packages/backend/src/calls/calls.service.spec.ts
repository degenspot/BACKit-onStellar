import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CallsService } from './calls.service';
import { CallsRepository } from './calls.repository';
import { CallReport } from './entities/call-report.entity';
import { IpfsService } from '../storage/ipfs.service';

describe('CallsService', () => {
  let service: CallsService;

  const callsRepository = {
    findFeed: jest.fn(),
    findFeedByFollowing: jest.fn(),
    searchVisible: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const callReportRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((dto) => dto),
  };

  const ipfsService = {};

  const cacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: CallsRepository, useValue: callsRepository },
        { provide: getRepositoryToken(CallReport), useValue: callReportRepository },
        { provide: IpfsService, useValue: ipfsService },
        { provide: CACHE_MANAGER, useValue: cacheManager },
      ],
    }).compile();

    service = module.get<CallsService>(CallsService);
  });

  // ─── existing tests ────────────────────────────────────────────────────────

  it('returns following feed with pagination', async () => {
    callsRepository.findFeedByFollowing.mockResolvedValue([[{ id: 'c1' }], 1]);
    const result = await service.getFollowingFeed('GA123', { page: 2, limit: 5 });
    expect(callsRepository.findFeedByFollowing).toHaveBeenCalledWith('GA123', 2, 5);
    expect(result).toEqual({ data: [{ id: 'c1' }], total: 1, page: 2, limit: 5 });
  });

  it('returns empty list when user follows nobody', async () => {
    callsRepository.findFeedByFollowing.mockResolvedValue([[], 0]);
    const result = await service.getFollowingFeed('GA999', {});
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  // ─── cache invalidation tests ──────────────────────────────────────────────

  describe('invalidateFeedCache', () => {
    it('deletes feed_cache key from cache manager', async () => {
      cacheManager.del.mockResolvedValue(undefined);
      await service.invalidateFeedCache();
      expect(cacheManager.del).toHaveBeenCalledWith('feed_cache');
      expect(cacheManager.del).toHaveBeenCalledTimes(1);
    });
  });

  describe('getFeed cache miss', () => {
    it('hits the repository on a cache miss (no prior cache)', async () => {
      callsRepository.findFeed.mockResolvedValue([[{ id: 'f1' }], 1]);
      const result = await service.getFeed({ page: 1, limit: 10 });
      expect(callsRepository.findFeed).toHaveBeenCalledWith(1, 10);
      expect(result).toEqual({ data: [{ id: 'f1' }], total: 1, page: 1, limit: 10 });
    });
  });

  describe('reportCall cache invalidation', () => {
    it('invalidates feed cache after a call is reported', async () => {
      const mockCall = { id: 'call-1', reportCount: 0, isHidden: false };
      callsRepository.findOne.mockResolvedValue(mockCall);
      callReportRepository.findOne.mockResolvedValue(null);
      callReportRepository.save.mockResolvedValue({});
      callsRepository.save.mockResolvedValue(mockCall);
      cacheManager.del.mockResolvedValue(undefined);

      await service.reportCall('call-1', 'GA_REPORTER', { reason: 'spam' } as any);

      expect(cacheManager.del).toHaveBeenCalledWith('feed_cache');
    });

    it('does not invalidate cache when call is not found', async () => {
      callsRepository.findOne.mockResolvedValue(null);
      await expect(
        service.reportCall('missing-id', 'GA_REPORTER', { reason: 'spam' } as any),
      ).rejects.toThrow('Call not found');
      expect(cacheManager.del).not.toHaveBeenCalled();
    });
  });
});
