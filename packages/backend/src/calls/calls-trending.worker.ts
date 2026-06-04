import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CallsTrendingService } from './calls-trending.service';

@Injectable()
export class CallsTrendingWorker {
  private readonly logger = new Logger(CallsTrendingWorker.name);

  constructor(private readonly trendingService: CallsTrendingService) {}

  @Cron('*/5 * * * *')
  async refreshTrendingScores(): Promise<void> {
    try {
      const result = await this.trendingService.recomputeAll();
      this.logger.debug(
        `Trending cron tick complete (callsProcessed=${result.callsProcessed})`,
      );
    } catch (err: any) {
      this.logger.error(
        `Trending cron tick failed: ${err?.message ?? err}`,
        err?.stack,
      );
    }
  }
}
