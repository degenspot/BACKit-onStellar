jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn(() => ({})),
    })),
  };
});

jest.mock('../utils/retry', () => {
  const actual = jest.requireActual('../utils/retry');
  return {
    ...actual,
    retryWithBackoff: (fn: any) => fn(),
  };
});

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { OracleService } from './oracle.service';
import { OracleCall, OracleCallStatus } from './entities/oracle-call.entity';
import { OracleOutcome } from './entities/oracle-outcome.entity';
import { OracleHealthService } from './oracle-health.service';
import { SigningService } from './signing.service';
import { IpfsService } from '../storage/ipfs.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('OracleService', () => {
  let service: OracleService;

  const rpcServer = {
    simulateTransaction: jest.fn(),
  };
  const oracleCallRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn((v) => v),
    create: jest.fn((v) => v),
  };
  const oracleOutcomeRepo = {
    create: jest.fn((v) => v),
    save: jest.fn((v) => v),
    find: jest.fn(),
  };
  const oracleHealth = {
    recordOperation: jest.fn().mockResolvedValue(undefined),
  };
  const signingService = {
    signOutcome: jest.fn().mockReturnValue('sig'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OracleService,
        { provide: SorobanRpc.Server, useValue: rpcServer },
        { provide: getRepositoryToken(OracleCall), useValue: oracleCallRepo },
        {
          provide: getRepositoryToken(OracleOutcome),
          useValue: oracleOutcomeRepo,
        },
        { provide: OracleHealthService, useValue: oracleHealth },
        { provide: SigningService, useValue: signingService },
        { provide: IpfsService, useValue: { pinEvidencePayload: jest.fn().mockResolvedValue('cid123') } },
      ],
    }).compile();

    service = module.get(OracleService);
  });

  it('fetchOraclePrice returns i128 lo bigint and records health op', async () => {
    const { SorobanRpc } = await import('@stellar/stellar-sdk');
    jest.spyOn(SorobanRpc.Api, 'isSimulationError').mockReturnValue(false);
    rpcServer.simulateTransaction.mockResolvedValue({
      result: {
        retval: {
          i128: () => ({
            lo: () => ({
              toBigInt: () => 123n,
            }),
          }),
        },
      },
    });

    const price = await service.fetchOraclePrice('CID', 'BTC');

    expect(price).toBe(123n);
    expect(oracleHealth.recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.any(String),
        success: true,
      }),
    );
  });

  it('fetchOraclePrice throws on simulation error and records failure', async () => {
    jest.useFakeTimers();
    const { SorobanRpc } = await import('@stellar/stellar-sdk');
    jest.spyOn(SorobanRpc.Api, 'isSimulationError').mockReturnValue(true);
    rpcServer.simulateTransaction.mockResolvedValue({
      error: 'boom',
    });
    const promise = service.fetchOraclePrice('CID', 'BTC').then(
      () => null,
      (err) => err as Error,
    );
    await jest.advanceTimersByTimeAsync(7_000);
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Oracle simulation error/);
    expect(oracleHealth.recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
      }),
    );
    jest.useRealTimers();
  });

  it('fetchOraclePrice throws when result is missing and records failure', async () => {
    jest.useFakeTimers();
    const { SorobanRpc } = await import('@stellar/stellar-sdk');
    jest.spyOn(SorobanRpc.Api, 'isSimulationError').mockReturnValue(false);
    rpcServer.simulateTransaction.mockResolvedValueOnce({
      result: null,
    });
    const promise = service.fetchOraclePrice('CID', 'BTC').then(
      () => null,
      (err) => err as Error,
    );
    await jest.advanceTimersByTimeAsync(7_000);
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect(oracleHealth.recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
    jest.useRealTimers();
  });

  it('resolveMarket signs and stores outcome, then marks call resolved', async () => {
    const call: Partial<OracleCall> = {
      id: 1,
      pairAddress: 'PAIR',
      strikePrice: 100,
      status: OracleCallStatus.OPEN,
      reportCount: 0,
      isHidden: false,
    };
    oracleCallRepo.findOne.mockResolvedValue(call);

    await service.resolveMarket(1, '110');

    expect(signingService.signOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 1,
        price: 110,
        outcome: 'YES',
        pairAddress: 'PAIR',
      }),
    );
    expect(oracleOutcomeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'YES',
        signature: 'sig',
      }),
    );
    expect(oracleCallRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: OracleCallStatus.RESOLVED_YES,
        finalPrice: '110',
      }),
    );
    expect(oracleHealth.recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.any(String),
        success: true,
      }),
    );
  });

  it('resolveMarket stores outcome even when IPFS pinning fails', async () => {
    const call: Partial<OracleCall> = {
      id: 2,
      pairAddress: 'PAIR2',
      strikePrice: 100,
      status: OracleCallStatus.OPEN,
      reportCount: 0,
      isHidden: false,
    };
    oracleCallRepo.findOne.mockResolvedValue(call);

    // Make IPFS pinning throw — resolution should still succeed
    const ipfsMock = { pinEvidencePayload: jest.fn().mockRejectedValue(new Error('IPFS down')) };
    (service as any).ipfsService = ipfsMock;

    await service.resolveMarket(2, '90');

    expect(oracleOutcomeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'NO', signature: 'sig' }),
    );
    expect(oracleCallRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OracleCallStatus.RESOLVED_NO }),
    );
  });

  it('getMarketStatus maps oracle call statuses to coarse lifecycle', async () => {
    oracleCallRepo.findOne.mockResolvedValueOnce({
      id: 1,
      status: OracleCallStatus.DRAFT,
    });
    await expect(service.getMarketStatus(1)).resolves.toBe('PENDING');

    oracleCallRepo.findOne.mockResolvedValueOnce({
      id: 2,
      status: OracleCallStatus.OPEN,
    });
    await expect(service.getMarketStatus(2)).resolves.toBe('ACTIVE');

    oracleCallRepo.findOne.mockResolvedValueOnce({
      id: 3,
      status: OracleCallStatus.PAUSED,
    });
    await expect(service.getMarketStatus(3)).resolves.toBe('PAUSED');

    oracleCallRepo.findOne.mockResolvedValueOnce({
      id: 4,
      status: OracleCallStatus.RESOLVED_NO,
    });
    await expect(service.getMarketStatus(4)).resolves.toBe('RESOLVED');

    oracleCallRepo.findOne.mockResolvedValueOnce({
      id: 5,
      status: 'SOME_FUTURE_STATUS' as any,
    });
    await expect(service.getMarketStatus(5)).resolves.toBe('PENDING');
  });

  it('recordReport increments reportCount and auto-pauses when threshold reached', async () => {
    const call: any = {
      id: 1,
      status: OracleCallStatus.OPEN,
      reportCount: 4,
      isHidden: false,
    };
    oracleCallRepo.findOne.mockResolvedValueOnce(call);
    oracleCallRepo.save.mockImplementation(async (v: any) => v);

    const updated = await service.recordReport(1);

    expect(updated.reportCount).toBe(5);
    expect(updated.isHidden).toBe(true);
    expect(updated.status).toBe(OracleCallStatus.PAUSED);
  });

  it('unpauseCall only unpauses paused calls', async () => {
    oracleCallRepo.findOne.mockResolvedValueOnce({
      id: 1,
      status: OracleCallStatus.PAUSED,
      failedAt: new Date(),
    });
    oracleCallRepo.save.mockImplementation(async (v: any) => v);

    const updated = await service.unpauseCall(1);
    expect(updated.status).toBe(OracleCallStatus.OPEN);
    expect(updated.failedAt).toBeNull();
  });

  it('adminResolveCall force-resolves an open call', async () => {
    oracleCallRepo.findOne.mockResolvedValueOnce({
      id: 1,
      status: OracleCallStatus.OPEN,
      failedAt: new Date(),
    });
    oracleCallRepo.save.mockImplementation(async (v: any) => v);

    const updated = await service.adminResolveCall(
      1,
      OracleCallStatus.RESOLVED_YES,
      '123.45',
    );

    expect(updated.status).toBe(OracleCallStatus.RESOLVED_YES);
    expect(updated.finalPrice).toBe('123.45');
    expect(updated.failedAt).toBeNull();
  });

  it('createOracleCall creates and saves new call', async () => {
    oracleCallRepo.create.mockReturnValueOnce({ id: 1 } as any);
    oracleCallRepo.save.mockResolvedValueOnce({ id: 1 } as any);

    await expect(
      service.createOracleCall('PAIR', 'BASE', 'QUOTE', 12.3, new Date()),
    ).resolves.toEqual({ id: 1 });
    expect(oracleCallRepo.create).toHaveBeenCalled();
    expect(oracleCallRepo.save).toHaveBeenCalled();
  });

  it('getPendingCalls filters on processedAt/failedAt null', async () => {
    oracleCallRepo.find.mockResolvedValueOnce([{ id: 1 } as any]);
    await expect(service.getPendingCalls()).resolves.toEqual([
      { id: 1 } as any,
    ]);
    expect(oracleCallRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.any(Object) }),
    );
  });

  it('getOutcomesForCall includes relations', async () => {
    oracleOutcomeRepo.find.mockResolvedValueOnce([{ id: 9 } as any]);
    await expect(service.getOutcomesForCall(1)).resolves.toEqual([
      { id: 9 } as any,
    ]);
    expect(oracleOutcomeRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ relations: ['call'] }),
    );
  });

  it('fetchAllPrices uses fetchOraclePrice via retry wrapper', async () => {
    const spy = jest
      .spyOn(service, 'fetchOraclePrice')
      .mockResolvedValueOnce(1n)
      .mockResolvedValueOnce(2n);

    await expect(
      service.fetchAllPrices('CID', ['BTC', 'ETH']),
    ).resolves.toEqual({
      BTC: 1n,
      ETH: 2n,
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('simulateContractRead proxies through retry wrapper', async () => {
    rpcServer.simulateTransaction.mockResolvedValueOnce({ ok: true });
    await expect(service.simulateContractRead({} as any, 'x')).resolves.toEqual(
      {
        ok: true,
      },
    );
    expect(rpcServer.simulateTransaction).toHaveBeenCalled();
  });

  it('resolveMarket blocks paused markets and marks failedAt', async () => {
    const call: any = {
      id: 1,
      pairAddress: 'PAIR',
      strikePrice: 100,
      status: OracleCallStatus.PAUSED,
      reportCount: 99,
      isHidden: true,
    };
    oracleCallRepo.findOne.mockResolvedValueOnce(call);
    oracleCallRepo.save.mockImplementation(async (v: any) => v);

    await expect(service.resolveMarket(1, '110')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(oracleCallRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ failedAt: expect.any(Date) }),
    );
    expect(oracleHealth.recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  it('resolveMarket is idempotent for terminal status', async () => {
    oracleCallRepo.findOne.mockResolvedValueOnce({
      id: 1,
      pairAddress: 'PAIR',
      strikePrice: 100,
      status: OracleCallStatus.RESOLVED_NO,
    });
    await expect(service.resolveMarket(1, '90')).resolves.toBeUndefined();
    expect(oracleOutcomeRepo.save).not.toHaveBeenCalled();
  });

  it('resolveMarket rejects non-resolvable statuses', async () => {
    oracleCallRepo.findOne.mockResolvedValueOnce({
      id: 1,
      pairAddress: 'PAIR',
      strikePrice: 100,
      status: OracleCallStatus.DRAFT,
    });
    await expect(service.resolveMarket(1, '90')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(oracleHealth.recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  it('unpauseCall rejects when call is not paused', async () => {
    oracleCallRepo.findOne.mockResolvedValueOnce({
      id: 1,
      status: OracleCallStatus.OPEN,
    });
    await expect(service.unpauseCall(1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('adminResolveCall rejects when status is not resolvable', async () => {
    oracleCallRepo.findOne.mockResolvedValueOnce({
      id: 1,
      status: OracleCallStatus.RESOLVED_YES,
    });
    await expect(
      service.adminResolveCall(1, OracleCallStatus.RESOLVED_NO),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getMarketStatus throws NotFound when call is missing', async () => {
    oracleCallRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.getMarketStatus(999)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updateParams and setQuorum return success payloads', async () => {
    await expect(
      service.updateParams('feed-1', { minResponses: 1, heartbeatSeconds: 2 }),
    ).resolves.toEqual({ success: true, feedId: 'feed-1' });
    await expect(service.setQuorum('round-1', 7)).resolves.toEqual({
      success: true,
      roundId: 'round-1',
    });
  });
});
