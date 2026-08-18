import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import {
  LeaderboardCacheService,
  LeaderboardPeriod,
} from './leaderboard-cache.service';
import { PredictionCall, CallStatus, CallOutcome } from './leaderboard.entity';

@Injectable()
export class LeaderboardSyncService {
  private readonly logger = new Logger(LeaderboardSyncService.name);

  constructor(
    private readonly cacheService: LeaderboardCacheService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Daily at 00:05 UTC — recalculate all scores from PostgreSQL and write to Redis.
   * This corrects any drift between event-driven updates and ground truth.
   */
  @Cron('5 0 * * *', { timeZone: 'UTC' })
  async syncAllTime(): Promise<void> {
    this.logger.log('Starting daily all_time leaderboard sync');
    await this.syncPeriod('all_time', null);
    this.logger.log('Completed daily all_time leaderboard sync');
  }

  /**
   * Every Monday at 00:10 UTC — rebuild the weekly leaderboard from scratch.
   */
  @Cron('10 0 * * 1', { timeZone: 'UTC' })
  async syncWeekly(): Promise<void> {
    this.logger.log('Starting weekly leaderboard sync');
    await this.syncPeriod('weekly', this.getLastMonday());
    this.logger.log('Completed weekly leaderboard sync');
  }

  /**
   * First day of each month at 00:15 UTC — rebuild monthly leaderboard.
   */
  @Cron('15 0 1 * *', { timeZone: 'UTC' })
  async syncMonthly(): Promise<void> {
    this.logger.log('Starting monthly leaderboard sync');
    await this.syncPeriod('monthly', this.getFirstOfMonth());
    this.logger.log('Completed monthly leaderboard sync');
  }

  // ─── public for testing ────────────────────────────────────────────────────

  async syncPeriod(period: LeaderboardPeriod, since: Date | null) {
    try {
      let qb = this.dataSource
        .createQueryBuilder()
        .select('pc.userId', 'userId')
        .addSelect('COUNT(*)', 'totalCalls')
        .addSelect(
          `SUM(CASE WHEN pc.outcome = '${CallOutcome.WON}' THEN 1 ELSE 0 END)`,
          'wonCalls',
        )
        .addSelect('COALESCE(SUM(pc.profitUsdc), 0)', 'totalProfitUsdc')
        .from(PredictionCall, 'pc')
        .where('pc.status = :status', { status: CallStatus.SETTLED });

      if (since) {
        qb = qb.andWhere('pc.settledAt >= :since', { since });
      }

      const rows: Array<{
        userId: string;
        totalCalls: string;
        wonCalls: string;
        totalProfitUsdc: string;
      }> = await qb.groupBy('pc.userId').getRawMany();

      const entries = rows.map((row) => {
        const totalCalls = Number(row.totalCalls);
        const wonCalls = Number(row.wonCalls);
        const totalProfitStroops = Math.round(
          Number(row.totalProfitUsdc) * 1_000_000,
        );
        return {
          address: row.userId,
          score: LeaderboardCacheService.computeScore(
            wonCalls,
            totalCalls,
            totalProfitStroops,
          ),
        };
      });

      await this.cacheService.bulkSet(period, entries);
      this.logger.log(`Synced ${entries.length} users for period=${period}`);
    } catch (err: any) {
      this.logger.error(`Sync failed for period=${period}: ${err.message}`);
      throw err;
    }
  }

  // ─── private date helpers ──────────────────────────────────────────────────

  private getLastMonday(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    const day = d.getUTCDay(); // 0 = Sun, 1 = Mon
    d.setUTCDate(d.getUTCDate() - ((day + 6) % 7)); // roll back to Monday
    return d;
  }

  private getFirstOfMonth(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(1);
    return d;
  }
}
