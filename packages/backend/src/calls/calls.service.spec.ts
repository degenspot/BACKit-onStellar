import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CallsService } from './calls.service';
import { CallsRepository } from './calls.repository';
import { CallReport } from './entities/call-report.entity';
import { OracleService } from '../oracle/oracle.service';
import { IpfsService } from '../storage/ipfs.service';

describe('CallsService', () => {
  let service: CallsService;

  const callsRepository = {
    findFeedByFollowing: jest.fn(),
  };

  const callReportRepository = {};
  const oracleService = {};
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
        { provide: OracleService, useValue: oracleService },
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
});
