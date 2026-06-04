import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import {
  OracleHealthLog,
  OracleOperationType,
} from './entities/oracle-health-log.entity';
import { OracleHealthService } from './oracle-health.service';

const mockRepo = {
  create: jest.fn((dto) => dto),
  save: jest.fn(),
  find: jest.fn(),
};

const makeLog = (
  offset: number,
  overrides: Partial<OracleHealthLog> = {},
): OracleHealthLog => ({
  id: `log-${offset}`,
  oracleKey: 'oracle-key',
  callId: 'call-1',
  operation: OracleOperationType.FETCH,
  submissionTime: new Date(Date.UTC(2026, 0, 1, 0, 0, offset)),
  priceFetched: 1,
  success: true,
  errorMessage: null,
  latencyMs: 100,
  expectedPrice: null,
  deviationPercent: null,
  deviationBreached: false,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, offset)),
  ...overrides,
});

describe('OracleHealthService', () => {
  let service: OracleHealthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.ORACLE_HEALTH_WEBHOOK_URL;
    delete process.env.ORACLE_ALERT_WEBHOOK_URL;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OracleHealthService,
        {
          provide: getRepositoryToken(OracleHealthLog),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<OracleHealthService>(OracleHealthService);
  });

  it('calculates success rate, average latency, and last 10 operations', () => {
    const logs = Array.from({ length: 12 }, (_, index) =>
      makeLog(index, {
        success: index !== 0 && index !== 1,
        latencyMs: 50 + index,
      }),
    );

    const health = service.calculateHealth(logs);

    expect(health.successRate).toBeCloseTo(83.33, 2);
    expect(health.averageLatencyMs).toBeCloseTo(55.5, 1);
    expect(health.last10Operations).toHaveLength(10);
    expect(health.last10Operations[0].id).toBe('log-11');
    expect(health.last10Operations[9].id).toBe('log-2');
  });

  it('alerts when success rate drops below 90 percent', () => {
    const logs = [
      makeLog(3, { success: true }),
      makeLog(2, { success: true }),
      makeLog(1, { success: false }),
      makeLog(0, { success: false }),
    ];

    const alerts = service.evaluateAlerts(logs);

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'SUCCESS_RATE_LOW' }),
      ]),
    );
  });

  it('alerts when the last 3 operations failed', () => {
    const logs = [
      makeLog(3, { success: false }),
      makeLog(2, { success: false }),
      makeLog(1, { success: false }),
      makeLog(0, { success: true }),
    ];

    const alerts = service.evaluateAlerts(logs);

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'LAST_THREE_FAILED' }),
      ]),
    );
  });

  it('alerts when deviation exceeds the safety threshold', () => {
    const logs = [
      makeLog(1, {
        deviationPercent: 8,
        deviationBreached: true,
      }),
      makeLog(0),
    ];

    const alerts = service.evaluateAlerts(logs);

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'PRICE_DEVIATION' }),
      ]),
    );
  });

  it('records deviation details while logging an operation', async () => {
    mockRepo.find.mockResolvedValue([]);

    await service.recordOperation({
      oracleKey: 'oracle-key',
      callId: 42,
      operation: OracleOperationType.SUBMIT,
      submissionTime: new Date(),
      priceFetched: 112,
      expectedPrice: 100,
      success: true,
    });

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: '42',
        deviationPercent: 12,
        deviationBreached: true,
      }),
    );
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });
});
