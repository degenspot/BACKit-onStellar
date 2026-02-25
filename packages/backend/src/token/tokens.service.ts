import { Injectable, Logger } from '@nestjs/common';
import { TokensRepository } from './tokens.repository';
import { Token } from './entities/token.entity';

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
    logoUrl: 'https://stellar.expert/img/assets/USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN.svg',
  },
  {
    assetCode: 'yXLM',
    assetIssuer: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55',
    decimals: 7,
    logoUrl: 'https://stellar.expert/img/assets/yXLM-GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55.svg',
  },
];

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(private readonly tokensRepository: TokensRepository) {}

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