import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PriceDeviationService } from './deiviation.service';
import { CoinGeckoService } from './coinGeko.service';
import { PriceDeviationLog } from './entities/log.entity';

const mockCoinGecko = { getPrices: jest.fn() };

const mockLogRepo = {
  create: jest.fn((dto) => dto),
  save: jest.fn(),
};

describe('PriceDeviationService', () => {
  let service: PriceDeviationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceDeviationService,
        { provide: CoinGeckoService, useValue: mockCoinGecko },
        {
          provide: getRepositoryToken(PriceDeviationLog),
          useValue: mockLogRepo,
        },
      ],
    }).compile();

    service = module.get<PriceDeviationService>(PriceDeviationService);
  });

  // ─── isSigningHalted / clearHalt ─────────────────────────────────────────

  it('signing is not halted on startup', () => {
    expect(service.isSigningHalted()).toBe(false);
  });

  it('clearHalt resets the flag', () => {
    // Breach to set the flag
    (service as any).signingHalted = true;
    service.clearHalt();
    expect(service.isSigningHalted()).toBe(false);
  });

  // ─── runDeviationCheck — within threshold ─────────────────────────────────

  it('does not halt signing when deviation is within threshold', async () => {
    mockCoinGecko.getPrices.mockResolvedValue(new Map([['XLM', 0.1]]));

    // Oracle is 2 % above reference — within default 5 % threshold
    const results = await service.runDeviationCheck([
      { symbol: 'XLM', usdPrice: 0.102 },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].breached).toBe(false);
    expect(results[0].deviationPercent).toBeCloseTo(2, 1);
    expect(service.isSigningHalted()).toBe(false);
    expect(mockLogRepo.save).toHaveBeenCalledTimes(1);
  });

  // ─── runDeviationCheck — breach ───────────────────────────────────────────

  it('halts signing and logs when deviation exceeds threshold', async () => {
    mockCoinGecko.getPrices.mockResolvedValue(new Map([['XLM', 0.1]]));

    // Oracle is 20 % above reference — exceeds 5 % threshold
    const results = await service.runDeviationCheck([
      { symbol: 'XLM', usdPrice: 0.12 },
    ]);

    expect(results[0].breached).toBe(true);
    expect(results[0].deviationPercent).toBeCloseTo(20, 1);
    expect(service.isSigningHalted()).toBe(true);
  });

  // ─── runDeviationCheck — multiple symbols, one breach ────────────────────

  it('halts signing if any one symbol breaches, even if others are fine', async () => {
    mockCoinGecko.getPrices.mockResolvedValue(
      new Map([
        ['XLM', 0.1],
        ['BTC', 50000],
      ]),
    );

    const results = await service.runDeviationCheck([
      { symbol: 'XLM', usdPrice: 0.101 }, // 1 % — fine
      { symbol: 'BTC', usdPrice: 60000 }, // 20 % — breach
    ]);

    expect(results.find((r) => r.symbol === 'XLM')!.breached).toBe(false);
    expect(results.find((r) => r.symbol === 'BTC')!.breached).toBe(true);
    expect(service.isSigningHalted()).toBe(true);
    expect(mockLogRepo.save).toHaveBeenCalledTimes(2);
  });

  // ─── runDeviationCheck — missing reference price ─────────────────────────

  it('skips a symbol when CoinGecko returns no price for it', async () => {
    mockCoinGecko.getPrices.mockResolvedValue(new Map()); // nothing returned

    const results = await service.runDeviationCheck([
      { symbol: 'XLM', usdPrice: 0.1 },
    ]);

    expect(results).toHaveLength(0);
    expect(mockLogRepo.save).not.toHaveBeenCalled();
    expect(service.isSigningHalted()).toBe(false);
  });

  // ─── edge: reference price is zero ───────────────────────────────────────

  it('does not divide by zero when reference price is 0', async () => {
    mockCoinGecko.getPrices.mockResolvedValue(new Map([['XLM', 0]]));

    const results = await service.runDeviationCheck([
      { symbol: 'XLM', usdPrice: 0.1 },
    ]);

    expect(results[0].deviationPercent).toBe(0);
    expect(results[0].breached).toBe(false);
  });
});
