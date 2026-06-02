import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PriceHistoryService } from './price-history.service';
import { TokensRepository } from './tokens.repository';

@Injectable()
export class PriceHistoryWorker {
  private readonly logger = new Logger(PriceHistoryWorker.name);

  constructor(
    private readonly priceHistoryService: PriceHistoryService,
    private readonly tokensRepository: TokensRepository,
  ) {}

  /** Poll DexScreener every 5 minutes for all active whitelisted tokens */
  @Cron('*/5 * * * *')
  async pollPrices(): Promise<void> {
    const tokens = await this.tokensRepository.findWhitelisted();
    const pairs = tokens
      .filter((t) => t.assetIssuer)
      .map((t) => `${t.assetCode}-${t.assetIssuer}`);

    for (const pair of pairs) {
      await this.priceHistoryService.recordPrice(pair);
    }
    this.logger.debug(`Polled prices for ${pairs.length} pairs`);
  }

  /** Daily cleanup: remove records older than 30 days */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanup(): Promise<void> {
    await this.priceHistoryService.deleteOlderThan(30);
  }
}
