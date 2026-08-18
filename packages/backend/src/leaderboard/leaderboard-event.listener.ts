import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { LeaderboardCacheService } from './leaderboard-cache.service';
import { PredictionCall, CallStatus, CallOutcome } from './leaderboard.entity';

export const OUTCOME_SUBMITTED_EVENT = 'outcome.submitted';

export interface OutcomeSubmittedPayload {
  /** User addresses affected by this outcome resolution */
  affectedAddresses: string[];
  /** Raw call ID (optional metadata) */
  callId?: string | number;
}

@Injectable()
export class LeaderboardEventListener {
  private readonly logger = new Logger(LeaderboardEventListener.name);

  constructor(
    private readonly cacheService: LeaderboardCacheService,
    @InjectRepository(PredictionCall)
    private readonly callRepo: Repository<PredictionCall>,
    private readonly dataSource: DataSource,
  ) {}

  @OnEvent(OUTCOME_SUBMITTED_EVENT)
  async handleOutcomeSubmitted(payload: OutcomeSubmittedPayload) {
    const { affectedAddresses } = payload;
    if (!affectedAddresses?.length) return;

    this.logger.debug(
      `OutcomeSubmitted: refreshing ${affectedAddresses.length} user(s) in Redis`,
    );

    await Promise.all(
      affectedAddresses.map((address) =>
        this.refreshUserScore(address).catch((err) =>
          this.logger.error(
            `Failed to refresh score for ${address}: ${err.message}`,
          ),
        ),
      ),
    );
  }

  async refreshUserScore(address: string): Promise<void> {
    const stats = await this.getUserStats(address);
    if (!stats) return;

    await this.cacheService.updateScore(
      address,
      stats.wonCalls,
      stats.totalCalls,
      stats.totalProfitStroops,
    );
  }

  private async getUserStats(userId: string): Promise<{
    wonCalls: number;
    totalCalls: number;
    totalProfitStroops: number;
  } | null> {
    const result = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'totalCalls')
      .addSelect(
        `SUM(CASE WHEN pc.outcome = '${CallOutcome.WON}' THEN 1 ELSE 0 END)`,
        'wonCalls',
      )
      .addSelect('COALESCE(SUM(pc.profitUsdc), 0)', 'totalProfitUsdc')
      .from(PredictionCall, 'pc')
      .where('pc.userId = :userId', { userId })
      .andWhere('pc.status = :status', { status: CallStatus.SETTLED })
      .getRawOne();

    if (!result) return null;

    const totalCalls = Number(result.totalCalls ?? 0);
    const wonCalls = Number(result.wonCalls ?? 0);
    // profitUsdc → convert to "XLM stroops equivalent" for score calculation
    // We treat profitUsdc as profit in micro-units (stroops) directly,
    // which keeps the formula consistent with issue spec.
    const totalProfitStroops = Math.round(
      Number(result.totalProfitUsdc ?? 0) * 1_000_000,
    );

    return { wonCalls, totalCalls, totalProfitStroops };
  }
}
