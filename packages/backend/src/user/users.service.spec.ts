import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { UsersService } from './users.service';
import { Users } from './entities/users.entity';
import { Follow } from './entities/follow.entity';
import { AnalyticsService } from '../analytics/analytics.service';
import { NotificationPreferencesService } from '../notifications/notification-preferences.service';

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
  };

  const cacheManager = {
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
});
