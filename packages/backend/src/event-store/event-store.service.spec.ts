import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventStoreService } from './event-store.service';
import {
  AggregateType,
  DomainEventType,
  EventStoreEntry,
} from './entities/event-store-entry.entity';
import { AggregateSnapshot } from './entities/aggregate-snapshot.entity';
import { correlationStorage } from '../common/middleware/correlation-id.middleware';

describe('EventStoreService', () => {
  let service: EventStoreService;

  const eventRepo = {
    create: jest.fn((v) => v),
    save: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const snapshotRepo = {
    create: jest.fn((v) => v),
    save: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    eventRepo.count.mockResolvedValue(0);
    snapshotRepo.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventStoreService,
        { provide: getRepositoryToken(EventStoreEntry), useValue: eventRepo },
        {
          provide: getRepositoryToken(AggregateSnapshot),
          useValue: snapshotRepo,
        },
      ],
    }).compile();

    service = module.get(EventStoreService);
  });

  describe('append', () => {
    it('persists an immutable event row via a single save() call', async () => {
      eventRepo.save.mockResolvedValue({ id: 'evt-1', sequence: '1' });

      const result = await service.append(
        AggregateType.CALL,
        'call-1',
        DomainEventType.CALL_CREATED,
        { title: 'BTC > 100k' },
        { userAddress: 'GA1' },
      );

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType: AggregateType.CALL,
          aggregateId: 'call-1',
          eventType: DomainEventType.CALL_CREATED,
          payload: { title: 'BTC > 100k' },
        }),
      );
      expect(eventRepo.save).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: 'evt-1', sequence: '1' });
    });

    it('stamps a correlation_id from the request-scoped AsyncLocalStorage when none is passed explicitly', async () => {
      eventRepo.save.mockImplementation(async (v) => v);

      await correlationStorage.run({ correlationId: 'corr-abc' }, async () => {
        await service.append(
          AggregateType.USER,
          'GA1',
          DomainEventType.USER_REGISTERED,
          { walletAddress: 'GA1' },
        );
      });

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ correlationId: 'corr-abc' }),
        }),
      );
    });

    it('falls back to "unknown" correlation_id outside of a request context', async () => {
      eventRepo.save.mockImplementation(async (v) => v);

      await service.append(
        AggregateType.USER,
        'GA1',
        DomainEventType.USER_REGISTERED,
        { walletAddress: 'GA1' },
      );

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ correlationId: 'unknown' }),
        }),
      );
    });

    it('an explicit metadata.correlationId wins over the ambient one', async () => {
      eventRepo.save.mockImplementation(async (v) => v);

      await correlationStorage.run({ correlationId: 'ambient' }, async () => {
        await service.append(
          AggregateType.USER,
          'GA1',
          DomainEventType.USER_REGISTERED,
          { walletAddress: 'GA1' },
          { correlationId: 'explicit' },
        );
      });

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ correlationId: 'explicit' }),
        }),
      );
    });

    it('a snapshot-check failure never propagates out of append()', async () => {
      eventRepo.save.mockResolvedValue({ id: 'evt-1', sequence: '1' });
      eventRepo.count.mockRejectedValue(new Error('db down'));

      await expect(
        service.append(
          AggregateType.CALL,
          'call-1',
          DomainEventType.CALL_CREATED,
          {},
        ),
      ).resolves.toEqual({ id: 'evt-1', sequence: '1' });
    });
  });

  describe('getEvents', () => {
    it('returns the full stream for an aggregate ordered oldest-first', async () => {
      const rows = [{ sequence: '1' }, { sequence: '2' }];
      eventRepo.find.mockResolvedValue(rows);

      const result = await service.getEvents(AggregateType.CALL, 'call-1');

      expect(eventRepo.find).toHaveBeenCalledWith({
        where: { aggregateType: AggregateType.CALL, aggregateId: 'call-1' },
        order: { sequence: 'ASC' },
      });
      expect(result).toBe(rows);
    });
  });

  describe('getEventsSince', () => {
    it('queries by createdAt and orders oldest-first', async () => {
      eventRepo.find.mockResolvedValue([]);
      const since = new Date('2026-01-01T00:00:00Z');

      await service.getEventsSince(since);

      expect(eventRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ order: { sequence: 'ASC' } }),
      );
    });
  });

  describe('replayAggregate', () => {
    it('folds events in sequence order, later events overriding earlier keys', async () => {
      snapshotRepo.findOne.mockResolvedValue(null);
      eventRepo.find.mockResolvedValue([
        {
          sequence: '1',
          eventType: DomainEventType.CALL_CREATED,
          payload: { status: 'OPEN', title: 'BTC > 100k' },
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          sequence: '2',
          eventType: DomainEventType.CALL_RESOLVED,
          payload: { status: 'RESOLVED_YES' },
          createdAt: new Date('2026-01-02T00:00:00Z'),
        },
      ] as unknown as EventStoreEntry[]);

      const result = await service.replayAggregate(
        AggregateType.CALL,
        'call-1',
      );

      expect(result.version).toBe(2);
      expect(result.lastSequence).toBe('2');
      expect(result.lastEventType).toBe(DomainEventType.CALL_RESOLVED);
      // title survives from the first event; status is overridden by the second
      expect(result.state).toEqual({
        status: 'RESOLVED_YES',
        title: 'BTC > 100k',
      });
    });

    it('starts from the latest snapshot instead of replaying the full history', async () => {
      snapshotRepo.findOne.mockResolvedValue({
        sequence: '5',
        version: 5,
        state: { status: 'OPEN', title: 'BTC > 100k' },
      });
      eventRepo.find.mockResolvedValue([
        {
          sequence: '6',
          eventType: DomainEventType.CALL_RESOLVED,
          payload: { status: 'RESOLVED_YES' },
          createdAt: new Date('2026-01-03T00:00:00Z'),
        },
      ] as unknown as EventStoreEntry[]);

      const result = await service.replayAggregate(
        AggregateType.CALL,
        'call-1',
      );

      // only events *after* the snapshot's sequence are pulled from the DB
      expect(eventRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            aggregateType: AggregateType.CALL,
            aggregateId: 'call-1',
          }),
        }),
      );
      expect(result.version).toBe(6);
      expect(result.state).toEqual({
        status: 'RESOLVED_YES',
        title: 'BTC > 100k',
      });
    });

    it('returns an empty state for an aggregate with no events', async () => {
      snapshotRepo.findOne.mockResolvedValue(null);
      eventRepo.find.mockResolvedValue([]);

      const result = await service.replayAggregate(AggregateType.CALL, 'ghost');

      expect(result).toEqual({
        aggregateType: AggregateType.CALL,
        aggregateId: 'ghost',
        version: 0,
        lastSequence: null,
        lastEventType: null,
        lastEventAt: null,
        state: {},
      });
    });
  });

  describe('snapshot compaction', () => {
    it('does not snapshot before the interval is reached', async () => {
      eventRepo.save.mockResolvedValue({ id: 'evt-1', sequence: '5' });
      eventRepo.count.mockResolvedValue(5); // below the 20-event interval

      await service.append(
        AggregateType.CALL,
        'call-1',
        DomainEventType.CALL_CREATED,
        {},
      );

      expect(snapshotRepo.save).not.toHaveBeenCalled();
    });

    it('snapshots once the unsnapshotted event count reaches the interval', async () => {
      eventRepo.save.mockResolvedValue({ id: 'evt-20', sequence: '20' });
      eventRepo.count.mockResolvedValue(20); // hits the 20-event interval
      eventRepo.find.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          sequence: String(i + 1),
          eventType: DomainEventType.CALL_CREATED,
          payload: { n: i + 1 },
          createdAt: new Date(),
        })) as unknown as EventStoreEntry[],
      );

      await service.append(
        AggregateType.CALL,
        'call-1',
        DomainEventType.CALL_CREATED,
        {},
      );

      expect(snapshotRepo.save).toHaveBeenCalledTimes(1);
      expect(snapshotRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregateType: AggregateType.CALL,
          aggregateId: 'call-1',
          sequence: '20',
          version: 20,
        }),
      );
    });
  });
});
