import { Test, TestingModule } from '@nestjs/testing';
import { EventsController } from './events.controller';
import { EventStoreService } from './event-store.service';
import { AggregateType } from './entities/event-store-entry.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

describe('EventsController', () => {
  let controller: EventsController;

  const eventStoreService = {
    queryEvents: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventsController],
      providers: [{ provide: EventStoreService, useValue: eventStoreService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(EventsController);
  });

  it('maps aggregate_type/aggregate_id query params onto EventStoreService.queryEvents', async () => {
    eventStoreService.queryEvents.mockResolvedValue({
      data: [{ id: 'evt-1' }],
      total: 1,
    });

    const result = await controller.findAll({
      aggregate_type: AggregateType.CALL,
      aggregate_id: 'call-1',
      from: '2024-01-01T00:00:00Z',
      to: '2024-12-31T23:59:59Z',
      page: 2,
      limit: 10,
    });

    expect(eventStoreService.queryEvents).toHaveBeenCalledWith({
      aggregateType: AggregateType.CALL,
      aggregateId: 'call-1',
      from: new Date('2024-01-01T00:00:00Z'),
      to: new Date('2024-12-31T23:59:59Z'),
      page: 2,
      limit: 10,
    });
    expect(result).toEqual({
      data: [{ id: 'evt-1' }],
      total: 1,
      page: 2,
      limit: 10,
    });
  });

  it('defaults page/limit in the response when the query omits them', async () => {
    eventStoreService.queryEvents.mockResolvedValue({ data: [], total: 0 });

    const result = await controller.findAll({});

    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
  });
});
