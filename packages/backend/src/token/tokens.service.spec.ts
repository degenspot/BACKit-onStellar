import { of, throwError } from 'rxjs';
import { TokensService } from './tokens.service';

describe('TokensService DexScreener proxy', () => {
  const tokensRepository: any = {
    findAllActive: jest.fn(),
    findByAsset: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const httpService: any = {
    get: jest.fn(),
  };

  let service: TokensService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TokensService(tokensRepository, httpService);
  });

  it('proxies search and returns normalized format', async () => {
    httpService.get.mockReturnValue(
      of({
        data: {
          pairs: [
            {
              pairAddress: 'pair_1',
              baseToken: { symbol: 'XLM' },
              quoteToken: { symbol: 'USDC' },
              priceUsd: '0.12',
              liquidity: { usd: '1000' },
              dexId: 'stellar',
              url: 'https://dexscreener.com/stellar/pair_1',
            },
          ],
        },
      }),
    );

    const result = await service.searchDexPairs('xlm');
    expect(result.query).toBe('XLM');
    expect(result.items[0].pairAddress).toBe('pair_1');
    expect(result.items[0].priceUsd).toBe(0.12);
  });

  it('returns cached search response on 429', async () => {
    httpService.get.mockReturnValueOnce(
      of({
        data: {
          pairs: [{ pairAddress: 'pair_2', baseToken: { symbol: 'XLM' } }],
        },
      }),
    );
    await service.searchDexPairs('XLM');

    httpService.get.mockReturnValueOnce(
      throwError(() => ({ response: { status: 429 } })),
    );
    const fallback = await service.searchDexPairs('XLM');
    expect(fallback.cached).toBe(true);
    expect(fallback.items[0].pairAddress).toBe('pair_2');
  });

  it('returns cached pair price on upstream failure', async () => {
    (service as any).priceCache.set('pair_3', {
      expiresAt: Date.now() + 15_000,
      data: {
        pairAddress: 'pair_3',
        priceUsd: 0.55,
        updatedAt: new Date().toISOString(),
        cached: false,
      },
    });

    httpService.get.mockReturnValueOnce(throwError(() => new Error('down')));
    const fallback = await service.getPairPrice('pair_3');
    expect(fallback.cached).toBe(true);
    expect(fallback.priceUsd).toBe(0.55);
  });
});
