import { HttpService } from '@nestjs/axios';
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { TokensRepository } from './tokens.repository';
import { Token } from './entities/token.entity';
import { WhitelistTokenDto } from './dto/whitelist-token.dto';
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

const HORIZON_URL =
  process.env.HORIZON_URL ||
  (process.env.NETWORK_PASSPHRASE?.includes('Test')
    ? 'https://horizon-testnet.stellar.org'
    : 'https://horizon.stellar.org');

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

  async getAll(whitelistedOnly = false): Promise<Token[]> {
    if (whitelistedOnly) {
      return this.tokensRepository.findWhitelisted();
    }
    return this.tokensRepository.findAllActive();
  }

  async whitelistToken(
    dto: WhitelistTokenDto,
    adminAddress: string,
  ): Promise<Token> {
    const assetCode = dto.assetCode.toUpperCase();
    const assetIssuer = dto.assetIssuer?.trim() || null;

    const existing = await this.tokensRepository.findByAsset(
      assetCode,
      assetIssuer,
    );

    if (existing && existing.isWhitelisted) {
      throw new BadRequestException(
        `Token ${assetCode}${assetIssuer ? `:${assetIssuer}` : ''} is already whitelisted`,
      );
    }

    if (assetIssuer) {
      await this.validateAssetOnHorizon(assetCode, assetIssuer);
    }

    const homeDomain = assetIssuer
      ? await this.fetchHomeDomain(assetIssuer)
      : null;

    const decimals = dto.decimals ?? 7;

    if (homeDomain) {
      this.logger.log(`Token issuer home domain: ${homeDomain}`);
    }

    if (existing) {
      existing.isWhitelisted = true;
      existing.addedBy = adminAddress;
      existing.addedAt = new Date();
      existing.decimals = decimals;
      if (dto.logoUrl) existing.logoUrl = dto.logoUrl;
      existing.isActive = true;
      return this.tokensRepository.save(existing);
    }

    const token = this.tokensRepository.create({
      assetCode,
      assetIssuer,
      decimals,
      logoUrl: dto.logoUrl ?? null,
      isActive: true,
      isWhitelisted: true,
      addedBy: adminAddress,
      addedAt: new Date(),
    });

    return this.tokensRepository.save(token);
  }

  async removeWhitelistedToken(id: string): Promise<void> {
    const token = await this.tokensRepository.findById(id);
    if (!token) {
      throw new NotFoundException(`Token with id ${id} not found`);
    }
    if (!token.isWhitelisted) {
      throw new BadRequestException(`Token ${id} is not whitelisted`);
    }
    token.isWhitelisted = false;
    await this.tokensRepository.save(token);
  }

  private async validateAssetOnHorizon(
    code: string,
    issuer: string,
  ): Promise<void> {
    const url = `${HORIZON_URL}/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}&limit=1`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, { timeout: 10000 }),
      );

      const records: any[] = response.data?._embedded?.records ?? [];
      if (records.length === 0) {
        throw new BadRequestException(
          `Asset ${code}:${issuer} does not exist on the Stellar network`,
        );
      }
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        `Failed to validate asset on Stellar network: ${error?.message ?? 'unknown error'}`,
      );
    }
  }

  private async fetchHomeDomain(issuer: string): Promise<string | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${HORIZON_URL}/accounts/${encodeURIComponent(issuer)}`,
          {
            timeout: 10000,
          },
        ),
      );
      return response.data?.home_domain ?? null;
    } catch {
      return null;
    }
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
