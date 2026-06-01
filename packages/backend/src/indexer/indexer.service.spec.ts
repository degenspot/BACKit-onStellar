import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IndexerService } from './indexer.service';
import { EventParser } from './event-parser';
import { EventLog } from './event-log.entity';
import { PlatformSettings } from './entities/platform-settings.entity';
import { ConfigService } from '../config/config.service';
import { SorobanRpc } from '@stellar/stellar-sdk';

const mockEventLogQueryBuilder = {
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getRawOne: jest.fn(),
  getOne: jest.fn(),
  getMany: jest.fn(),
};

describe('IndexerService', () => {
  let service: IndexerService;
  let eventLogRepository: Repository<EventLog>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerService,
        EventParser,
        {
          provide: SorobanRpc.Server,
          useValue: {
            getEvents: jest.fn(),
            getLedgerEntries: jest.fn(),
            getLatestLedger: jest.fn(),
            sendTransaction: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(EventLog),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            count: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            createQueryBuilder: jest.fn(() => mockEventLogQueryBuilder),
          },
        },
        {
          provide: getRepositoryToken(PlatformSettings),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('https://api.test'),
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
    jest.spyOn(eventLogRepository, 'findOne' as any).mockResolvedValue({
      ledger: 12345,
      timestamp: new Date(),
    });

    const status = await service.getStatus();

    expect(status).toEqual({
      isRunning: true,
      lastProcessedLedger: 12345,
      totalEventsIndexed: 42,
      latestEventLedger: 12345,
      latestEventTimestamp: expect.any(Date),
    });
  });

  it('should get events by type', async () => {
    const mockEvents = [{ id: 1, eventType: 'call_created' }];
    jest.spyOn(eventLogRepository, 'find' as any).mockResolvedValue(mockEvents);

    const events = await service.getEventsByType('call_created' as any);

    expect(events).toEqual(mockEvents);
    expect(eventLogRepository.find).toHaveBeenCalledWith({
      where: { eventType: 'call_created' },
      order: { ledger: 'DESC' },
      take: 50,
    });
  });
});
