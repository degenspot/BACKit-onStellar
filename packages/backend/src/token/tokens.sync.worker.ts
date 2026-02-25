import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TokensService } from './tokens.service';

@Injectable()
export class TokensSyncWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(TokensSyncWorker.name);

  constructor(private readonly tokensService: TokensService) {}

  /** Run once on boot so tokens are available immediately */
  async onApplicationBootstrap(): Promise<void> {
    await this.tokensService.syncWhitelist();
  }

  /** Re-sync every 6 hours to pick up logo/decimal changes */
  @Cron(CronExpression.EVERY_6_HOURS)
  async handleCron(): Promise<void> {
    this.logger.log('Scheduled token sync triggered');
    await this.tokensService.syncWhitelist();
  }
}