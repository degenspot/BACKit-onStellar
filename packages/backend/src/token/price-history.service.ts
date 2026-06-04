import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository, MoreThan, LessThan } from 'typeorm';
import { PriceHistory } from './entities/price-history.entity';
import { TokensService } from './tokens.service';

export type PricePeriod = '1h' | '24h' | '7d';

const PERIOD_MS: Record<PricePeriod, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

@Injectable()
export class PriceHistoryService {
  private readonly logger = new Logger(PriceHistoryService.name);
  private readonly repo: Repository<PriceHistory>;

  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly tokensService: TokensService,
  ) {
    this.repo = dataSource.getRepository(PriceHistory);
  }

  async recordPrice(tokenPair: string): Promise<void> {
    try {
      const { priceUsd } = await this.tokensService.getPairPrice(tokenPair);
      if (!priceUsd) return;

      const entry = this.repo.create({
        tokenPair,
        price: priceUsd,
        timestamp: new Date(),
        source: 'dexscreener',
      });
      await this.repo.save(entry);
    } catch (err) {
      this.logger.warn(`Failed to record price for ${tokenPair}: ${err}`);
    }
  }

  async getHistory(
    tokenPair: string,
    period: PricePeriod = '24h',
  ): Promise<PriceHistory[]> {
    const since = new Date(Date.now() - PERIOD_MS[period]);
    return this.repo.find({
      where: { tokenPair, timestamp: MoreThan(since) },
      order: { timestamp: 'ASC' },
      select: ['timestamp', 'price', 'source'],
    });
  }

  async deleteOlderThan(days: number): Promise<void> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await this.repo.delete({ timestamp: LessThan(cutoff) });
    this.logger.log(`Deleted price history older than ${days} days`);
  }
}
