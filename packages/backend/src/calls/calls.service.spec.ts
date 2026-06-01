import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  NotFoundException,
  HttpStatus,
} from '@nestjs/common';
import { CallsService } from './calls.service';
import { CallsRepository } from './calls.repository';
import { CallReport } from './entities/call-report.entity';
import { IpfsService } from '../storage/ipfs.service';
import { Call, CallStatus } from './entities/call.entity';

describe('CallsService', () => {
  let service: CallsService;

  const callsRepository = {
    findFeedByFollowing: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };

  const callReportRepository = {
    findOne: jest.fn(),
    count: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };
  const ipfsService = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallsService,
        { provide: CallsRepository, useValue: callsRepository },
        {
          provide: getRepositoryToken(CallReport),
          useValue: callReportRepository,
        },
        { provide: IpfsService, useValue: ipfsService },
      ],
    }).compile();

    service = module.get<CallsService>(CallsService);
  });

  it('returns following feed with pagination', async () => {
    callsRepository.findFeedByFollowing.mockResolvedValue([[{ id: 'c1' }], 1]);

    const result = await service.getFollowingFeed('GA123', {
      page: 2,
      limit: 5,
    });

    expect(callsRepository.findFeedByFollowing).toHaveBeenCalledWith(
      'GA123',
      2,
      5,
    );
    expect(result).toEqual({
      data: [{ id: 'c1' }],
      total: 1,
      page: 2,
      limit: 5,
    });
  });

  it('returns empty list when user follows nobody', async () => {
    callsRepository.findFeedByFollowing.mockResolvedValue([[], 0]);

    const result = await service.getFollowingFeed('GA999', {});

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('throws if reporting a non-existing call', async () => {
    callsRepository.findOne.mockResolvedValue(null);
    await expect(
      service.reportCall('call-id', 'GA_USER', { reason: undefined }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws if user already reported same call', async () => {
    callsRepository.findOne.mockResolvedValue({
      id: 'call-id',
      reportCount: 0,
      isHidden: false,
      status: CallStatus.OPEN,
    } as Call);
    callReportRepository.findOne.mockResolvedValue({ id: 'r1' });

    await expect(
      service.reportCall('call-id', 'GA_USER', { reason: undefined }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enforces max 10 reports per hour per reporter', async () => {
    callsRepository.findOne.mockResolvedValue({
      id: 'call-id',
      reportCount: 0,
      isHidden: false,
      status: CallStatus.OPEN,
    } as Call);
    callReportRepository.findOne.mockResolvedValue(null);
    callReportRepository.count.mockResolvedValue(10);

    await expect(
      service.reportCall('call-id', 'GA_USER', { reason: undefined }),
    ).rejects.toHaveProperty('status', HttpStatus.TOO_MANY_REQUESTS);
  });
});
