/// <reference types="multer" />
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
    calculateReputationScore: jest.fn().mockResolvedValue(100),
  };

  const ipfsService = {
    pinAvatar: jest.fn().mockResolvedValue('mock_cid'),
  };

  const cacheManager = {
    del: jest.fn().mockResolvedValue(undefined),
  };

  const eventEmitter = {
    emit: jest.fn(),
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
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('prevents self-follow', async () => {
    await expect(service.follow('A', 'A')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws 409 for duplicate follow', async () => {
    usersRepo.findOne.mockResolvedValue({ id: 'u1', walletAddress: 'A' });
    followsRepo.findOne.mockResolvedValue({ id: 'f1' });

    await expect(service.follow('A', 'B')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('creates a new follow relation', async () => {
    usersRepo.findOne
      .mockResolvedValueOnce({ id: 'u1', walletAddress: 'A' })
      .mockResolvedValueOnce({ id: 'u2', walletAddress: 'B' });
    followsRepo.findOne.mockResolvedValue(null);
    followsRepo.create.mockReturnValue({
      followerAddress: 'A',
      followingAddress: 'B',
    });
    followsRepo.save.mockResolvedValue({
      id: 'f1',
      followerAddress: 'A',
      followingAddress: 'B',
    });

    const result = await service.follow('A', 'B');
    expect(result.id).toBe('f1');
    expect(eventEmitter.emit).toHaveBeenCalledWith('user.followed', {
      followerAddress: 'A',
      followingAddress: 'B',
    });
  });

  it('returns paginated followers', async () => {
    followsRepo.findAndCount.mockResolvedValue([[{ id: 'f1' }], 1]);
    const result = await service.getFollowers('B', 2, 10);
    expect(result).toEqual({
      data: [{ id: 'f1' }],
      total: 1,
      page: 2,
      limit: 10,
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
