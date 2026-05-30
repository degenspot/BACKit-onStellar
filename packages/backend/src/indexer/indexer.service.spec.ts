import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IndexerService } from './indexer.service';
import { EventParser } from './event-parser';
import { EventLog } from './event-log.entity';

describe('IndexerService', () => {
  let service: IndexerService;
  let eventLogRepository: Repository<EventLog>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerService,
        EventParser,
        {
          provide: getRepositoryToken(EventLog),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn(() => ({
              select: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              addOrderBy: jest.fn().mockReturnThis(),
              take: jest.fn().mockReturnThis(),
              getRawOne: jest.fn(),
              getOne: jest.fn(),
              getMany: jest.fn(),
            })),
          },
        },
      ],
    }).compile();

    service = module.get<IndexerService>(IndexerService);
    eventLogRepository = module.get<Repository<EventLog>>(
      getRepositoryToken(EventLog),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return status', async () => {
    jest.spyOn(eventLogRepository, 'count').mockResolvedValue(42);
    jest
      .spyOn(
        eventLogRepository.createQueryBuilder().getOne as any,
        'mockResolvedValue',
      )
      .mockResolvedValue({
        ledger: 12345,
        timestamp: new Date(),
      });

    const status = await service.getStatus();

    expect(status).toEqual({
      isRunning: true,
      lastProcessedLedger: null,
      totalEventsIndexed: 42,
      latestEventLedger: 12345,
      latestEventTimestamp: expect.any(Date),
    });
  });

  it('should get events by type', async () => {
    const mockEvents = [{ id: 1, eventType: 'call_created' }];
    jest
      .spyOn(
        eventLogRepository.createQueryBuilder().getMany as any,
        'mockResolvedValue',
      )
      .mockResolvedValue(mockEvents);

    const events = await service.getEventsByType('call_created' as any);

    expect(events).toEqual(mockEvents);
    expect(eventLogRepository.createQueryBuilder).toHaveBeenCalled();
  });
});
