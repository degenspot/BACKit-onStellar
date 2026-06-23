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
import { Token } from '../token/entities/token.entity';
import { PriceDeviationLog } from './entities/log.entity';
import { OracleHealthLog } from './entities/oracle-health-log.entity';
import { PriceFetcherService } from './price-fetcher.service';
import { CoinGeckoService } from './coinGeko.service';

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
  const tokenRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn((v) => v),
    create: jest.fn((v) => v),
  };
  const priceDeviationLogRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn((v) => v),
  };
  const oracleHealthLogRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn((v) => v),
  };
  const priceFetcherRepo = {
    fetchPrice: jest.fn(),
  };
  const coinGeckoRepo = {
    getPrices: jest.fn(),
  };
  const oracleHealth = {
    recordOperation: jest.fn().mockResolvedValue(undefined),
  };
  const signingService = {
    signOutcome: jest.fn().mockReturnValue('sig'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Mock global.fetch by default to return empty orderbook (skips validation)
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ bids: [], asks: [] }),
      }),
    ) as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OracleService,
        { provide: SorobanRpc.Server, useValue: rpcServer },
        { provide: getRepositoryToken(OracleCall), useValue: oracleCallRepo },
        {
          provide: getRepositoryToken(OracleOutcome),
          useValue: oracleOutcomeRepo,
        },
        { provide: getRepositoryToken(Token), useValue: tokenRepo },
        {
          provide: getRepositoryToken(PriceDeviationLog),
          useValue: priceDeviationLogRepo,
        },
        {
          provide: getRepositoryToken(OracleHealthLog),
          useValue: oracleHealthLogRepo,
        },
        { provide: OracleHealthService, useValue: oracleHealth },
        { provide: SigningService, useValue: signingService },
        {
          provide: IpfsService,
          useValue: {
            pinEvidencePayload: jest.fn().mockResolvedValue('cid123'),
          },
        },
        { provide: PriceFetcherService, useValue: priceFetcherRepo },
        { provide: CoinGeckoService, useValue: coinGeckoRepo },
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
    const ipfsMock = {
      pinEvidencePayload: jest.fn().mockRejectedValue(new Error('IPFS down')),
    };
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

  describe('Horizon Orderbook Cross-Check', () => {
    it('normal price with low deviation passes cross-validation', async () => {
      const call: Partial<OracleCall> = {
        id: 10,
        pairAddress: 'PAIR',
        baseToken: 'XLM',
        quoteToken: 'USDC',
        strikePrice: 1.0,
        status: OracleCallStatus.OPEN,
        reportCount: 0,
        isHidden: false,
      };
      oracleCallRepo.findOne.mockResolvedValue(call);

      // Mock Horizon orderbook midpoint: 1.0
      // DexScreener observed price: 1.02 (2% deviation)
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              bids: [{ price: '0.99' }],
              asks: [{ price: '1.01' }],
            }),
        }),
      ) as any;

      await expect(service.resolveMarket(10, '1.02')).resolves.toBeUndefined();
      expect(oracleCallRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OracleCallStatus.RESOLVED_YES,
          finalPrice: '1.02',
        }),
      );
      expect(oracleHealth.recordOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          dexScreenerPrice: 1.02,
          horizonPrice: 1.0,
        }),
      );
    });

    it('high deviation triggers review and halts submission', async () => {
      const call: Partial<OracleCall> = {
        id: 11,
        pairAddress: 'PAIR',
        baseToken: 'XLM',
        quoteToken: 'USDC',
        strikePrice: 1.0,
        status: OracleCallStatus.OPEN,
        reportCount: 0,
        isHidden: false,
        needsAdminReview: false,
      };
      oracleCallRepo.findOne.mockResolvedValue(call);

      // Mock Horizon orderbook midpoint: 1.0
      // DexScreener price: 1.10 (10% deviation, threshold is 5%)
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              bids: [{ price: '0.98' }],
              asks: [{ price: '1.02' }],
            }),
        }),
      ) as any;

      await expect(service.resolveMarket(11, '1.10')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(oracleCallRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          needsAdminReview: true,
          failedAt: expect.any(Date),
        }),
      );
      expect(oracleHealth.recordOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          dexScreenerPrice: 1.1,
          horizonPrice: 1.0,
        }),
      );
    });

    it('no Horizon data is gracefully skipped and continues', async () => {
      const call: Partial<OracleCall> = {
        id: 12,
        pairAddress: 'PAIR',
        baseToken: 'XLM',
        quoteToken: 'USDC',
        strikePrice: 1.0,
        status: OracleCallStatus.OPEN,
        reportCount: 0,
        isHidden: false,
      };
      oracleCallRepo.findOne.mockResolvedValue(call);

      // Empty bids/asks
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ bids: [], asks: [] }),
        }),
      ) as any;

      await expect(service.resolveMarket(12, '1.02')).resolves.toBeUndefined();
      expect(oracleCallRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OracleCallStatus.RESOLVED_YES,
          finalPrice: '1.02',
        }),
      );
      expect(oracleHealth.recordOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          dexScreenerPrice: 1.02,
          horizonPrice: null,
        }),
      );
    });
  });

  describe('getPriceSources', () => {
    it('returns price sources from health log and deviation log', async () => {
      const call = {
        id: 13,
        pairAddress: 'PAIR',
        baseToken: 'XLM',
        quoteToken: 'USDC',
      };
      oracleCallRepo.findOne.mockResolvedValue(call);

      oracleHealthLogRepo.findOne.mockResolvedValue({
        dexScreenerPrice: 0.12,
        horizonPrice: 0.125,
      });

      priceDeviationLogRepo.findOne.mockResolvedValue({
        referencePrice: 0.119,
      });

      const res = await service.getPriceSources(13);
      expect(res).toEqual({
        callId: 13,
        pairAddress: 'PAIR',
        baseToken: 'XLM',
        quoteToken: 'USDC',
        sources: [
          { source: 'DexScreener', value: 0.12 },
          { source: 'Horizon SDEX', value: 0.125 },
          { source: 'CoinGecko', value: 0.119 },
        ],
      });
    });

    /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
    it('getPriceSources handles live fetch errors gracefully', async () => {
      const call = {
        id: 14,
        pairAddress: 'PAIR',
        baseToken: 'XLM',
        quoteToken: 'USDC',
      };
      oracleCallRepo.findOne.mockResolvedValue(call);
      oracleHealthLogRepo.findOne.mockResolvedValue(null);
      priceDeviationLogRepo.findOne.mockResolvedValue(null);

      // Force PriceFetcher to throw
      priceFetcherRepo.fetchPrice.mockRejectedValueOnce(
        new Error('DexScreener API down'),
      );

      // Force fetchHorizonMidpoint to throw by making fetch reject
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new Error('Horizon API down')) as any;

      coinGeckoRepo.getPrices.mockResolvedValueOnce({});

      const res = await service.getPriceSources(14);
      expect(res).toEqual({
        callId: 14,
        pairAddress: 'PAIR',
        baseToken: 'XLM',
        quoteToken: 'USDC',
        sources: [
          { source: 'DexScreener', value: null },
          { source: 'Horizon SDEX', value: null },
          { source: 'CoinGecko', value: null },
        ],
      });
    });
    /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
  });

  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
  describe('Branch Coverage Tests', () => {
    it('getAssetParams matches yXLM', async () => {
      const res = await (service as any).getAssetParams('yXLM');
      expect(res).toEqual({
        asset_type: 'credit_alphanum4',
        asset_code: 'yXLM',
        asset_issuer:
          'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55',
      });
    });

    it('getAssetParams matches code:issuer format', async () => {
      const res1 = await (service as any).getAssetParams(
        'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      expect(res1).toEqual({
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer:
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      });

      const res2 = await (service as any).getAssetParams(
        'SUPERLONGCODE:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      expect(res2).toEqual({
        asset_type: 'credit_alphanum12',
        asset_code: 'SUPERLONGCODE',
        asset_issuer:
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      });
    });

    it('getAssetParams handles database token lookup and errors', async () => {
      // Case 3a: Native token
      tokenRepo.findOne.mockResolvedValueOnce({
        assetCode: 'TESTNATIVE',
        assetIssuer: null,
      });
      const res1 = await (service as any).getAssetParams('TESTNATIVE');
      expect(res1).toEqual({ asset_type: 'native' });

      // Case 3b: 4-char token
      tokenRepo.findOne.mockResolvedValueOnce({
        assetCode: 'TEST',
        assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      });
      const res2 = await (service as any).getAssetParams('TEST');
      expect(res2).toEqual({
        asset_type: 'credit_alphanum4',
        asset_code: 'TEST',
        asset_issuer:
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      });

      // Case 3c: 12-char token
      tokenRepo.findOne.mockResolvedValueOnce({
        assetCode: 'VERYLONGCODE',
        assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      });
      const res3 = await (service as any).getAssetParams('VERYLONGCODE');
      expect(res3).toEqual({
        asset_type: 'credit_alphanum12',
        asset_code: 'VERYLONGCODE',
        asset_issuer:
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      });

      // Case 3d: DB Error
      tokenRepo.findOne.mockRejectedValueOnce(new Error('db down'));
      const res4 = await (service as any).getAssetParams('OTHER');
      expect(res4).toBeNull();
    });

    it('fetchHorizonMidpoint returns null when assets cannot be resolved', async () => {
      tokenRepo.findOne.mockResolvedValue(null); // Resolve fails
      const call = { baseToken: 'INVALID1', quoteToken: 'INVALID2' } as any;
      const res = await (service as any).fetchHorizonMidpoint(call);
      expect(res).toBeNull();
    });

    it('fetchHorizonMidpoint handles alphanumeric assets and constructs query parameters correctly', async () => {
      let requestedUrl = '';
      global.fetch = jest.fn().mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              bids: [{ price: '0.5' }],
              asks: [{ price: '0.6' }],
            }),
        });
      }) as any;

      const call = {
        baseToken:
          'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        quoteToken: 'yXLM',
      } as any;

      const res = await (service as any).fetchHorizonMidpoint(call);
      expect(res).toBe(0.55);
      expect(requestedUrl).toContain('selling_asset_code=USDC');
      expect(requestedUrl).toContain(
        'selling_asset_issuer=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      );
      expect(requestedUrl).toContain('buying_asset_code=yXLM');
      expect(requestedUrl).toContain(
        'buying_asset_issuer=GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55',
      );
    });

    it('fetchHorizonMidpoint returns null when Horizon API returns non-ok status', async () => {
      global.fetch = jest.fn().mockImplementation(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        }),
      ) as any;

      const call = { baseToken: 'XLM', quoteToken: 'yXLM' } as any;
      const res = await (service as any).fetchHorizonMidpoint(call);
      expect(res).toBeNull();
    });
  });
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
});
