import { of, throwError } from 'rxjs';
import { TokensService } from './tokens.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('TokensService', () => {
  const tokensRepository: any = {
    findAllActive: jest.fn(),
    findWhitelisted: jest.fn(),
    findById: jest.fn(),
    findByAsset: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const httpService: any = {
    get: jest.fn(),
  };

  let service: TokensService;

  beforeEach(() => {
    jest.resetAllMocks();
    tokensRepository.findAllActive = jest.fn();
    tokensRepository.findWhitelisted = jest.fn();
    tokensRepository.findById = jest.fn();
    tokensRepository.findByAsset = jest.fn();
    tokensRepository.save = jest.fn();
    tokensRepository.create = jest.fn();
    httpService.get = jest.fn();
    service = new TokensService(tokensRepository, httpService);
  });

  describe('DexScreener proxy', () => {
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

  describe('getAll', () => {
    it('returns all active tokens by default', async () => {
      const tokens = [{ id: '1', assetCode: 'XLM' }];
      tokensRepository.findAllActive.mockResolvedValue(tokens);

      const result = await service.getAll();
      expect(tokensRepository.findAllActive).toHaveBeenCalled();
      expect(result).toEqual(tokens);
    });

    it('returns only whitelisted tokens when whitelistedOnly is true', async () => {
      const tokens = [{ id: '1', assetCode: 'USDC', isWhitelisted: true }];
      tokensRepository.findWhitelisted.mockResolvedValue(tokens);

      const result = await service.getAll(true);
      expect(tokensRepository.findWhitelisted).toHaveBeenCalled();
      expect(result).toEqual(tokens);
    });
  });

  describe('whitelistToken', () => {
    const adminAddress =
      'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ';
    const dto = {
      assetCode: 'USDC',
      assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    };

    it('throws BadRequestException if token is already whitelisted', async () => {
      tokensRepository.findByAsset.mockResolvedValue({
        id: '1',
        isWhitelisted: true,
      });

      await expect(service.whitelistToken(dto, adminAddress)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException if asset does not exist on Horizon', async () => {
      tokensRepository.findByAsset.mockResolvedValue(null);
      httpService.get.mockReturnValue(
        of({ data: { _embedded: { records: [] } } }),
      );

      await expect(service.whitelistToken(dto, adminAddress)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates a new whitelisted token when valid', async () => {
      tokensRepository.findByAsset.mockResolvedValue(null);
      httpService.get
        .mockReturnValueOnce(
          of({ data: { _embedded: { records: [{ asset_code: 'USDC' }] } } }),
        )
        .mockReturnValueOnce(of({ data: { home_domain: 'circle.com' } }));

      tokensRepository.create.mockReturnValue({
        assetCode: 'USDC',
        assetIssuer: dto.assetIssuer,
      });
      tokensRepository.save.mockResolvedValue({
        id: 'new-id',
        assetCode: 'USDC',
        assetIssuer: dto.assetIssuer,
        isWhitelisted: true,
        addedBy: adminAddress,
        addedAt: expect.any(Date),
      });

      const result = await service.whitelistToken(dto, adminAddress);
      expect(tokensRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assetCode: 'USDC',
          isWhitelisted: true,
          addedBy: adminAddress,
        }),
      );
      expect(result.isWhitelisted).toBe(true);
    });

    it('updates existing token to whitelisted when found but not whitelisted', async () => {
      const existing = {
        id: '1',
        assetCode: 'USDC',
        assetIssuer: dto.assetIssuer,
        isWhitelisted: false,
        decimals: 7,
        isActive: true,
      };
      tokensRepository.findByAsset.mockResolvedValue(existing);
      httpService.get
        .mockReturnValueOnce(
          of({ data: { _embedded: { records: [{ asset_code: 'USDC' }] } } }),
        )
        .mockReturnValueOnce(of({ data: { home_domain: 'circle.com' } }));

      tokensRepository.save.mockResolvedValue({
        ...existing,
        isWhitelisted: true,
        addedBy: adminAddress,
        addedAt: expect.any(Date),
      });

      const result = await service.whitelistToken(dto, adminAddress);
      expect(tokensRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          isWhitelisted: true,
          addedBy: adminAddress,
        }),
      );
      expect(result.isWhitelisted).toBe(true);
    });

    it('accepts optional decimals and logoUrl', async () => {
      tokensRepository.findByAsset.mockResolvedValue(null);
      httpService.get
        .mockReturnValueOnce(
          of({ data: { _embedded: { records: [{ asset_code: 'USDC' }] } } }),
        )
        .mockReturnValueOnce(of({ data: { home_domain: 'circle.com' } }));

      tokensRepository.create.mockReturnValue({});
      tokensRepository.save.mockResolvedValue({ id: 'new-id' });

      await service.whitelistToken(
        { ...dto, decimals: 7, logoUrl: 'https://example.com/logo.svg' },
        adminAddress,
      );

      expect(tokensRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decimals: 7,
          logoUrl: 'https://example.com/logo.svg',
        }),
      );
    });
  });

  describe('removeWhitelistedToken', () => {
    it('throws NotFoundException when token does not exist', async () => {
      tokensRepository.findById.mockResolvedValue(null);

      await expect(service.removeWhitelistedToken('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when token is not whitelisted', async () => {
      tokensRepository.findById.mockResolvedValue({
        id: '1',
        isWhitelisted: false,
      });

      await expect(service.removeWhitelistedToken('1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sets isWhitelisted to false on valid removal', async () => {
      const token = { id: '1', isWhitelisted: true };
      tokensRepository.findById.mockResolvedValue(token);
      tokensRepository.save.mockResolvedValue({
        ...token,
        isWhitelisted: false,
      });

      await service.removeWhitelistedToken('1');

      expect(tokensRepository.save).toHaveBeenCalledWith({
        ...token,
        isWhitelisted: false,
      });
    });
  });
});
