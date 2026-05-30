import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { TokensRepository } from './tokens.repository';
import { Token } from './entities/token.entity';
import { firstValueFrom } from 'rxjs';

// Whitelist of trusted tokens — extend as needed
export const WHITELISTED_TOKENS: Partial<Token>[] = [
  {
    assetCode: 'XLM',
    assetIssuer: null,
    decimals: 7,
    logoUrl: 'https://stellar.expert/img/assets/XLM.svg',
  },
  {
    assetCode: 'USDC',
    assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    decimals: 7,
    logoUrl:
      'https://stellar.expert/img/assets/USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN.svg',
  },
  {
    assetCode: 'yXLM',
    assetIssuer: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55',
    decimals: 7,
    logoUrl:
      'https://stellar.expert/img/assets/yXLM-GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55.svg',
  },
];

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);
  private readonly outboundRequestTimestamps: number[] = [];
  private readonly searchCache = new Map<
    string,
    { expiresAt: number; data: DexSearchResponse }
  >();
  private readonly priceCache = new Map<
    string,
    { expiresAt: number; data: DexPriceResponse }
  >();

  constructor(
    private readonly tokensRepository: TokensRepository,
    private readonly httpService: HttpService,
  ) {}

  private async consumeQuota(): Promise<void> {
    const now = Date.now();
    const minuteAgo = now - 60_000;
    while (
      this.outboundRequestTimestamps.length > 0 &&
      this.outboundRequestTimestamps[0] < minuteAgo
    ) {
      this.outboundRequestTimestamps.shift();
    }

    if (this.outboundRequestTimestamps.length >= 10) {
      const waitForMs = this.outboundRequestTimestamps[0] + 60_000 - now;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(waitForMs, 0)),
      );
    }

    this.outboundRequestTimestamps.push(Date.now());
  }

  async searchDexPairs(query: string): Promise<DexSearchResponse> {
    const q = query.trim().toUpperCase();
    if (!q) {
      return { query: '', items: [], cached: false };
    }

    const cacheKey = q;
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.data, cached: true };
    }

    try {
      await this.consumeQuota();
      this.logger.log(`DexScreener outbound: /latest/dex/search?q=${q}`);
      const response = await firstValueFrom(
        this.httpService.get(
          `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
        ),
      );

      const pairs: any[] = Array.isArray(response.data?.pairs)
        ? response.data.pairs
        : [];
      const data: DexSearchResponse = {
        query: q,
        cached: false,
        items: pairs.map((pair) => ({
          pairAddress: String(pair?.pairAddress ?? ''),
          baseSymbol: String(pair?.baseToken?.symbol ?? ''),
          quoteSymbol: String(pair?.quoteToken?.symbol ?? ''),
          priceUsd: Number(pair?.priceUsd ?? 0),
          liquidityUsd: Number(pair?.liquidity?.usd ?? 0),
          dexId: String(pair?.dexId ?? ''),
          url: String(pair?.url ?? ''),
        })),
      };

      this.searchCache.set(cacheKey, {
        expiresAt: Date.now() + 60_000,
        data,
      });
      return data;
    } catch (error: any) {
      const status = error?.response?.status;
      const fallback = cached ?? this.searchCache.get(cacheKey);
      if ((status === 429 || !status) && fallback) {
        return { ...fallback.data, cached: true };
      }
      return { query: q, items: [], cached: false };
    }
  }

  async getPairPrice(pair: string): Promise<DexPriceResponse> {
    const pairId = pair.trim();
    const cached = this.priceCache.get(pairId);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.data, cached: true };
    }

    try {
      await this.consumeQuota();
      this.logger.log(
        `DexScreener outbound: /latest/dex/pairs/stellar/${pairId}`,
      );
      const response = await firstValueFrom(
        this.httpService.get(
          `https://api.dexscreener.com/latest/dex/pairs/stellar/${encodeURIComponent(pairId)}`,
        ),
      );
      const firstPair = Array.isArray(response.data?.pairs)
        ? response.data.pairs[0]
        : null;

      const data: DexPriceResponse = {
        pairAddress: pairId,
        priceUsd: Number(firstPair?.priceUsd ?? 0),
        updatedAt: new Date().toISOString(),
        cached: false,
      };

      this.priceCache.set(pairId, {
        expiresAt: Date.now() + 15_000,
        data,
      });
      return data;
    } catch (error: any) {
      const status = error?.response?.status;
      const fallback = cached ?? this.priceCache.get(pairId);
      if ((status === 429 || !status) && fallback) {
        return { ...fallback.data, cached: true };
      }
      return {
        pairAddress: pairId,
        priceUsd: 0,
        updatedAt: new Date().toISOString(),
        cached: false,
      };
    }
  }

  async getAll(): Promise<Token[]> {
    return this.tokensRepository.findAllActive();
  }

  /**
   * Upserts every token from the whitelist into the DB.
   * Called on startup and by the scheduled worker.
   */
  async syncWhitelist(): Promise<void> {
    this.logger.log('Syncing token whitelist…');

    for (const tokenData of WHITELISTED_TOKENS) {
      const existing = await this.tokensRepository.findByAsset(
        tokenData.assetCode!,
        tokenData.assetIssuer ?? null,
      );

      if (existing) {
        // Only update mutable fields — preserves any manual overrides
        await this.tokensRepository.save({
          ...existing,
          logoUrl: tokenData.logoUrl ?? existing.logoUrl,
          decimals: tokenData.decimals ?? existing.decimals,
          isActive: true,
        });
      } else {
        await this.tokensRepository.save(
          this.tokensRepository.create(tokenData),
        );
        this.logger.log(`Added token: ${tokenData.assetCode}`);
      }
    }

    this.logger.log('Token whitelist sync complete.');
  }
}

export type DexSearchResponse = {
  query: string;
  items: Array<{
    pairAddress: string;
    baseSymbol: string;
    quoteSymbol: string;
    priceUsd: number;
    liquidityUsd: number;
    dexId: string;
    url: string;
  }>;
  cached: boolean;
};

export type DexPriceResponse = {
  pairAddress: string;
  priceUsd: number;
  updatedAt: string;
  cached: boolean;
};
