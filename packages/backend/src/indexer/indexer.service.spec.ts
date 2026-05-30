import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { IndexerService } from './indexer.service';
import { EventLog } from './event-log.entity';
import { PlatformSettings } from './entities/platform-settings.entity';
import { ConfigService } from '../config/config.service';
import { PayoutsService } from '../payouts/payouts.service';
import { TreasuryService } from '../treasury/treasury.service';

jest.mock('./parsers/admin-params.parser', () => ({
  parseAdminParamsChanged: jest.fn(),
}));

jest.mock('../utils/retry', () => {
  const actual = jest.requireActual('../utils/retry');
  return {
    ...actual,
    retryWithBackoff: (fn: any) => fn(),
  };
});

describe('IndexerService', () => {
  let service: IndexerService;
  const rpcServer = {
    getEvents: jest.fn(),
    getLatestLedger: jest.fn(),
    getLedgerEntries: jest.fn(),
    sendTransaction: jest.fn(),
  };
  const eventLogRepo = {
    findOne: jest.fn(),
    count: jest.fn(),
    find: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn(),
  };
  const platformSettingsRepo = {
    findOne: jest.fn(),
    create: jest.fn((v) => v),
    save: jest.fn(),
  };
  const configService = {
    applyAdminParamsChanged: jest.fn(),
  };
  const payoutsService = {
    markClaimed: jest.fn(),
  };
  const treasuryService = {
    recordFeeFromPayoutClaimed: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.SOROBAN_CONTRACT_ID = 'CID';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerService,
        { provide: SorobanRpc.Server, useValue: rpcServer },
        { provide: getRepositoryToken(EventLog), useValue: eventLogRepo },
        {
          provide: getRepositoryToken(PlatformSettings),
          useValue: platformSettingsRepo,
        },
        { provide: ConfigService, useValue: configService },
        { provide: PayoutsService, useValue: payoutsService },
        { provide: TreasuryService, useValue: treasuryService },
      ],
    }).compile();

    service = module.get(IndexerService);
  });

  it('returns status with latest ledger info', async () => {
    eventLogRepo.count.mockResolvedValue(7);
    eventLogRepo.findOne.mockResolvedValueOnce({
      ledger: 99,
      timestamp: new Date('2026-05-29T00:00:00.000Z'),
    });

    const status = await service.getStatus();

    expect(status.totalEventsIndexed).toBe(7);
    expect(status.latestEventLedger).toBe(99);
    expect(status.latestEventTimestamp).toEqual(
      new Date('2026-05-29T00:00:00.000Z'),
    );
  });

  it('uses checkpoint ledger+1 when events exist', async () => {
    eventLogRepo.findOne.mockResolvedValueOnce({ ledger: 100 });
    rpcServer.getEvents.mockResolvedValue({ events: [] });

    await service.processNewEvents();

    expect(rpcServer.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        startLedger: 101,
      }),
    );
  });

  it('falls back to latestLedger.sequence-5 when no checkpoint', async () => {
    eventLogRepo.findOne.mockResolvedValueOnce(null);
    rpcServer.getLatestLedger.mockResolvedValue({ sequence: 50 });
    rpcServer.getEvents.mockResolvedValue({ events: [] });

    await service.processNewEvents();

    expect(rpcServer.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        startLedger: 45,
      }),
    );
  });

  it('dispatches PayoutClaimed events to payoutsService', async () => {
    eventLogRepo.findOne.mockResolvedValueOnce({ ledger: 1 });
    rpcServer.getEvents.mockResolvedValue({
      events: [
        {
          topic: [
            xdr.ScVal.scvSymbol('PayoutClaimed'),
            xdr.ScVal.scvU64(xdr.Uint64.fromString('123')),
            xdr.ScVal.scvString('GABC'),
          ],
          value: xdr.ScVal.scvVoid(),
          txHash: 'tx1',
          ledger: 2,
        },
      ],
    });

    await service.processNewEvents();

    // sanity: ensure we actually hit the event loop
    expect(rpcServer.getEvents).toHaveBeenCalled();
    expect(payoutsService.markClaimed).toHaveBeenCalledWith(
      '123',
      'GABC',
      'tx1',
      expect.any(Date),
    );
    expect(treasuryService.recordFeeFromPayoutClaimed).toHaveBeenCalledWith(
      expect.objectContaining({ callId: '123' }),
    );
  });

  it('skips indexer tick when SOROBAN_CONTRACT_ID is missing', async () => {
    // contractId is captured at construction time; override it for this test
    (service as any).contractId = '';
    await expect(service.processNewEvents()).resolves.toBeUndefined();
    expect(rpcServer.getEvents).not.toHaveBeenCalled();
  });

  it('handles AdminParamsChanged by applying config and saving event log', async () => {
    const { parseAdminParamsChanged } = await import(
      './parsers/admin-params.parser'
    );
    (parseAdminParamsChanged as any).mockReturnValueOnce({
      feePercent: 3,
    });

    eventLogRepo.findOne.mockResolvedValueOnce({ ledger: 1 });
    rpcServer.getEvents.mockResolvedValue({
      events: [
        {
          topic: [xdr.ScVal.scvSymbol('AdminParamsChanged')],
          value: xdr.ScVal.scvVoid(),
          txHash: 'txA',
          ledger: 2,
        },
      ],
    });

    await service.processNewEvents();

    expect(configService.applyAdminParamsChanged).toHaveBeenCalledWith(
      expect.objectContaining({ feePercent: 3 }),
    );
    expect(eventLogRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: expect.any(String),
        txHash: 'txA',
        ledger: 2,
      }),
    );
  });

  it('ignores events with empty topics or non-symbol first topic', async () => {
    eventLogRepo.findOne.mockResolvedValueOnce({ ledger: 1 });
    rpcServer.getEvents.mockResolvedValue({
      events: [
        { topic: [], value: xdr.ScVal.scvVoid(), txHash: 't0', ledger: 2 },
        {
          topic: [xdr.ScVal.scvU32(1)],
          value: xdr.ScVal.scvVoid(),
          txHash: 't1',
          ledger: 2,
        },
      ],
    });

    await service.processNewEvents();
    expect(configService.applyAdminParamsChanged).not.toHaveBeenCalled();
    expect(payoutsService.markClaimed).not.toHaveBeenCalled();
  });

  it('logs debug for unknown event names', async () => {
    eventLogRepo.findOne.mockResolvedValueOnce({ ledger: 1 });
    rpcServer.getEvents.mockResolvedValue({
      events: [
        {
          topic: [xdr.ScVal.scvSymbol('SomeOtherEvent')],
          value: xdr.ScVal.scvVoid(),
          txHash: 't2',
          ledger: 2,
        },
      ],
    });
    await expect(service.processNewEvents()).resolves.toBeUndefined();
  });

  it('handles payout parsing failures gracefully', async () => {
    eventLogRepo.findOne.mockResolvedValueOnce({ ledger: 1 });
    rpcServer.getEvents.mockResolvedValue({
      events: [
        {
          topic: [
            xdr.ScVal.scvSymbol('PayoutClaimed'),
            xdr.ScVal.scvVoid(), // bad callId
          ],
          value: xdr.ScVal.scvVoid(),
          txHash: 'txBad',
          ledger: 2,
        },
      ],
    });

    await service.processNewEvents();
    expect(payoutsService.markClaimed).not.toHaveBeenCalled();
    expect(treasuryService.recordFeeFromPayoutClaimed).not.toHaveBeenCalled();
  });

  it('resolveStartLedger clamps to 1 when latest ledger is small', async () => {
    eventLogRepo.findOne.mockResolvedValueOnce(null);
    rpcServer.getLatestLedger.mockResolvedValueOnce({ sequence: 3 });
    await expect((service as any).resolveStartLedger()).resolves.toBe(1);
  });

  it('does not throw when rpc call fails in tick', async () => {
    eventLogRepo.findOne.mockResolvedValueOnce({ ledger: 1 });
    rpcServer.getEvents.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(service.processNewEvents()).resolves.toBeUndefined();
  });

  it('getPlatformSettings creates default row when missing', async () => {
    platformSettingsRepo.findOne.mockResolvedValueOnce(null);
    platformSettingsRepo.save.mockResolvedValueOnce({ id: 1, feePercent: 0 });

    await expect(service.getPlatformSettings()).resolves.toEqual({
      id: 1,
      feePercent: 0,
    });
    expect(platformSettingsRepo.save).toHaveBeenCalled();
  });

  it('updatePlatformSettings updates feePercent and audit fields', async () => {
    const settings: any = { id: 1, feePercent: 0 };
    platformSettingsRepo.findOne.mockResolvedValueOnce(settings);
    platformSettingsRepo.save.mockImplementation(async (v: any) => v);

    const updated = await service.updatePlatformSettings(
      'fee_percent',
      7,
      'tx',
      10,
    );
    expect(updated.feePercent).toBe(7);
    expect(updated.lastUpdatedByTxHash).toBe('tx');
    expect(updated.lastUpdatedAtLedger).toBe(10);
  });

  it('getEventsByType proxies to repository find', async () => {
    eventLogRepo.find.mockResolvedValueOnce([{ id: 1 }]);
    await expect(service.getEventsByType('X' as any)).resolves.toEqual([{ id: 1 }]);
    expect(eventLogRepo.find).toHaveBeenCalled();
  });

  it('readContractData/getLatestLedger/submitTransaction proxy through rpc server', async () => {
    rpcServer.getLedgerEntries.mockResolvedValueOnce({ entries: [] });
    rpcServer.getLatestLedger.mockResolvedValueOnce({ sequence: 1 });
    rpcServer.sendTransaction.mockResolvedValueOnce({ status: 'SUCCESS' });

    await expect(service.readContractData('CID', {} as any)).resolves.toEqual({
      entries: [],
    });
    await expect(service.getLatestLedger()).resolves.toEqual({ sequence: 1 });
    await expect(service.submitTransaction({} as any)).resolves.toEqual({
      status: 'SUCCESS',
    });
  });

  it('parses i128 payout amount (lo) when present', async () => {
    const i128Val: any = {
      switch: () => xdr.ScValType.scvI128(),
      i128: () => ({
        lo: () => ({ toString: () => '123' }),
      }),
    };

    await (service as any).handlePayoutClaimed(
      [
        xdr.ScVal.scvSymbol('PayoutClaimed'),
        xdr.ScVal.scvU64(xdr.Uint64.fromString('1')),
        xdr.ScVal.scvString('GABC'),
        i128Val,
      ],
      'tx',
      1,
    );

    expect(treasuryService.recordFeeFromPayoutClaimed).toHaveBeenCalledWith(
      expect.objectContaining({ claimedAmount: '123' }),
    );
  });

  it('catches payout handler errors and does not throw', async () => {
    payoutsService.markClaimed.mockRejectedValueOnce(new Error('nope'));
    await expect(
      (service as any).handlePayoutClaimed(
        [
          xdr.ScVal.scvSymbol('PayoutClaimed'),
          xdr.ScVal.scvU64(xdr.Uint64.fromString('1')),
          xdr.ScVal.scvString('GABC'),
          xdr.ScVal.scvU64(xdr.Uint64.fromString('10')),
        ],
        'tx',
        1,
      ),
    ).resolves.toBeUndefined();
  });
});
