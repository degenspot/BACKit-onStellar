import { Test, TestingModule } from '@nestjs/testing';
/// <reference types="multer" />
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { UsersService } from './users.service';
import { Users } from './entities/users.entity';
import { Follow } from './entities/follow.entity';
import { AnalyticsService } from '../analytics/analytics.service';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';
import { IpfsService } from '../storage/ipfs.service';

describe('UsersService', () => {
  let service: UsersService;

  const usersRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const followsRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    findAndCount: jest.fn(),
    remove: jest.fn(),
    count: jest.fn(),
  };
  const analyticsService = {
    calculatePredictorReliability: jest.fn().mockResolvedValue(0.5),
    calculateReputationScore: jest.fn().mockResolvedValue(80),
    calculateReputationScore: jest.fn().mockResolvedValue(100),
  };

  const ipfsService = {
    pinAvatar: jest.fn().mockResolvedValue('mock_cid'),
  };
  const cacheManager = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(Users), useValue: usersRepo },
        { provide: getRepositoryToken(Follow), useValue: followsRepo },
        { provide: AnalyticsService, useValue: analyticsService },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        {
          provide: NotificationPreferencesService,
          useValue: { initializePreferences: jest.fn().mockResolvedValue([]) },
        },
        { provide: IpfsService, useValue: ipfsService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  // ─── existing tests ────────────────────────────────────────────────────────

  it('prevents self-follow', async () => {
    await expect(service.follow('A', 'A')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 409 for duplicate follow', async () => {
    usersRepo.findOne.mockResolvedValue({ id: 'u1', walletAddress: 'A' });
    followsRepo.findOne.mockResolvedValue({ id: 'f1' });
    await expect(service.follow('A', 'B')).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a new follow relation', async () => {
    usersRepo.findOne
      .mockResolvedValueOnce({ id: 'u1', walletAddress: 'A' })
      .mockResolvedValueOnce({ id: 'u2', walletAddress: 'B' });
    followsRepo.findOne.mockResolvedValue(null);
    followsRepo.create.mockReturnValue({ followerAddress: 'A', followingAddress: 'B' });
    followsRepo.save.mockResolvedValue({ id: 'f1', followerAddress: 'A', followingAddress: 'B' });
    const result = await service.follow('A', 'B');
    expect(result.id).toBe('f1');
  });

  it('returns paginated followers', async () => {
    followsRepo.findAndCount.mockResolvedValue([[{ id: 'f1' }], 1]);
    const result = await service.getFollowers('B', 2, 10);
    expect(result).toEqual({ data: [{ id: 'f1' }], total: 1, page: 2, limit: 10 });
  });

  // ─── cache invalidation tests ──────────────────────────────────────────────

  describe('profile cache invalidation on follow', () => {
    it('invalidates cache for both follower and following on follow', async () => {
      usersRepo.findOne
        .mockResolvedValueOnce({ id: 'u1', walletAddress: 'A' })
        .mockResolvedValueOnce({ id: 'u2', walletAddress: 'B' });
      followsRepo.findOne.mockResolvedValue(null);
      followsRepo.create.mockReturnValue({ followerAddress: 'A', followingAddress: 'B' });
      followsRepo.save.mockResolvedValue({ id: 'f1' });

      await service.follow('A', 'B');

      const deletedKeys = cacheManager.del.mock.calls.map((c: string[]) => c[0]);
      // invalidateUserProfile deletes 3 TTL ranges for each of 2 addresses = 6 deletes
      expect(cacheManager.del).toHaveBeenCalledTimes(6);
      expect(deletedKeys).toContain('profile:A:7d');
      expect(deletedKeys).toContain('profile:A:30d');
      expect(deletedKeys).toContain('profile:A:all');
      expect(deletedKeys).toContain('profile:B:7d');
      expect(deletedKeys).toContain('profile:B:30d');
      expect(deletedKeys).toContain('profile:B:all');
    });
  });

  describe('profile cache invalidation on unfollow', () => {
    it('invalidates cache for both addresses on unfollow', async () => {
      followsRepo.findOne.mockResolvedValue({ id: 'f1', followerAddress: 'A', followingAddress: 'B' });
      followsRepo.remove.mockResolvedValue({});

      await service.unfollow('A', 'B');

      expect(cacheManager.del).toHaveBeenCalledTimes(6);
      const deletedKeys = cacheManager.del.mock.calls.map((c: string[]) => c[0]);
      expect(deletedKeys).toContain('profile:A:all');
      expect(deletedKeys).toContain('profile:B:all');
    });

    it('throws BadRequestException when not following and does not touch cache', async () => {
      followsRepo.findOne.mockResolvedValue(null);
      await expect(service.unfollow('A', 'B')).rejects.toBeInstanceOf(BadRequestException);
      expect(cacheManager.del).not.toHaveBeenCalled();
    });
  });

  describe('cache miss — getUserByAddress', () => {
    it('fetches from DB and returns enriched profile on cache miss', async () => {
      const mockUser = { id: 'u1', walletAddress: 'GABC', badges: [] };
      usersRepo.findOne.mockResolvedValue(mockUser);
      followsRepo.count.mockResolvedValue(5);

      const result = await service.getUserByAddress('GABC');

      expect(usersRepo.findOne).toHaveBeenCalledWith({
        where: { walletAddress: 'GABC' },
        relations: ['badges'],
      });
      expect(result.walletAddress).toBe('GABC');
      expect(result.followerCount).toBe(5);
      expect(result.predictorReliability).toBe(0.5);
    });

    it('throws NotFoundException when user does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);
      const { NotFoundException } = await import('@nestjs/common');
      await expect(service.getUserByAddress('GMISSING')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('profile CRUD', () => {
    it('creates a new profile', async () => {
      usersRepo.findOne.mockResolvedValueOnce(null);
      usersRepo.create.mockReturnValue({
        walletAddress: 'GC1',
        displayName: 'Alice',
        bio: 'Hello',
        avatarCid: 'mock_cid',
      });
      usersRepo.save.mockResolvedValueOnce({ id: 'u1' });
      // For getUserByAddress
      usersRepo.findOne.mockResolvedValueOnce({
        id: 'u1',
        walletAddress: 'GC1',
        displayName: 'Alice',
        bio: 'Hello',
        avatarCid: 'mock_cid',
        badges: [],
      });
      followsRepo.count.mockResolvedValue(0);

      const file = {
        buffer: Buffer.from('test'),
        originalname: 'avatar.png',
      } as unknown as Express.Multer.File;
      const result = await service.createProfile(
        { walletAddress: 'GC1', displayName: 'Alice', bio: 'Hello' },
        file,
      );

      expect(ipfsService.pinAvatar).toHaveBeenCalledWith(file);
      expect(usersRepo.save).toHaveBeenCalled();
      expect(result.displayName).toBe('Alice');
      expect(result.avatarUrl).toBe('ipfs://mock_cid');
    });

    it('throws error if creating profile that already exists', async () => {
      usersRepo.findOne.mockResolvedValueOnce({ id: 'u1' });
      await expect(
        service.createProfile({ walletAddress: 'GC1', displayName: 'Alice' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updates an existing profile', async () => {
      const existingUser = {
        id: 'u1',
        walletAddress: 'GC1',
        displayName: 'OldName',
        bio: 'OldBio',
        avatarCid: 'old_cid',
      };
      usersRepo.findOne.mockResolvedValueOnce(existingUser);
      usersRepo.save.mockResolvedValueOnce(existingUser);
      usersRepo.findOne.mockResolvedValueOnce({
        ...existingUser,
        displayName: 'NewName',
        bio: 'NewBio',
        avatarCid: 'new_cid',
        badges: [],
      });
      followsRepo.count.mockResolvedValue(0);

      ipfsService.pinAvatar.mockResolvedValueOnce('new_cid');

      const file = {
        buffer: Buffer.from('test2'),
        originalname: 'avatar2.png',
      } as unknown as Express.Multer.File;
      const result = await service.updateProfile(
        { walletAddress: 'GC1', displayName: 'NewName', bio: 'NewBio' },
        file,
      );

      expect(ipfsService.pinAvatar).toHaveBeenCalledWith(file);
      expect(result.displayName).toBe('NewName');
      expect(result.avatarUrl).toBe('ipfs://new_cid');
    });

    it('throws error if updating profile that does not exist', async () => {
      usersRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.updateProfile({ walletAddress: 'GC1', displayName: 'Alice' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
