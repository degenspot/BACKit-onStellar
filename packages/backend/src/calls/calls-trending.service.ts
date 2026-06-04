import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Call } from './entities/call.entity';
import { CallTrendingScore } from './entities/call-trending-score.entity';

export type TrendingInputs = {
  stakeVolume24h: number;
  stakerCount24h: number;
  createdAt: Date;
  now: Date;
};

export type TrendingScoreBreakdown = {
  score: number;
  stakeVolume24h: number;
  stakerCount24h: number;
  recencyBonus: number;
  timeDecay: number;
};

@Injectable()
export class CallsTrendingService {
  private readonly logger = new Logger(CallsTrendingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Call) private readonly callRepository: Repository<Call>,
    @InjectRepository(CallTrendingScore)
    private readonly trendingRepository: Repository<CallTrendingScore>,
  ) {}

  computeTrendingScore(inputs: TrendingInputs): TrendingScoreBreakdown {
    const ageMs = Math.max(
      0,
      inputs.now.getTime() - inputs.createdAt.getTime(),
    );
    const ageHours = ageMs / (1000 * 60 * 60);

    // Recency bonus: higher for calls created within last 6 hours.
    // Linear ramp-down from 60 → 0 across 0–6 hours.
    const recencyBonus = ageHours <= 6 ? (6 - ageHours) * 10 : 0;

    // Exponential time decay. Older calls get a larger denominator.
    // Every +24h increases decay by e^1.
    const timeDecay = Math.exp(ageHours / 24);

    const numerator =
      inputs.stakeVolume24h * 2 + inputs.stakerCount24h * 3 + recencyBonus;

    const score = numerator / timeDecay;

    return {
      score,
      stakeVolume24h: inputs.stakeVolume24h,
      stakerCount24h: inputs.stakerCount24h,
      recencyBonus,
      timeDecay,
    };
  }

  /**
   * Recompute trending scores for all visible calls and store them in
   * call_trending_scores for fast retrieval by /calls/feed?sort=trending.
   */
  async recomputeAll(now: Date = new Date()): Promise<{
    callsProcessed: number;
  }> {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const calls = await this.callRepository.find({
      select: ['id', 'createdAt'],
      where: { isHidden: false },
    });

    if (calls.length === 0) return { callsProcessed: 0 };

    const stakeAggRows: Array<{
      callId: string;
      stakeVolume24h: string;
      stakerCount24h: string;
    }> = await this.dataSource.query(
      `
        SELECT
          s."callId" AS "callId",
          COALESCE(SUM(s."amount"), 0) AS "stakeVolume24h",
          COUNT(DISTINCT s."userAddress") AS "stakerCount24h"
        FROM stakes s
        WHERE s."createdAt" >= $1
        GROUP BY s."callId"
      `,
      [since],
    );

    const stakeAggByCallId = new Map<
      string,
      { stakeVolume24h: number; stakerCount24h: number }
    >();
    for (const row of stakeAggRows) {
      stakeAggByCallId.set(row.callId, {
        stakeVolume24h: Number(row.stakeVolume24h ?? 0),
        stakerCount24h: Number(row.stakerCount24h ?? 0),
      });
    }

    const toSave: CallTrendingScore[] = [];
    for (const call of calls) {
      const agg = stakeAggByCallId.get(call.id) ?? {
        stakeVolume24h: 0,
        stakerCount24h: 0,
      };

      const breakdown = this.computeTrendingScore({
        stakeVolume24h: agg.stakeVolume24h,
        stakerCount24h: agg.stakerCount24h,
        createdAt: call.createdAt,
        now,
      });

      toSave.push(
        this.trendingRepository.create({
          callId: call.id,
          score: breakdown.score.toFixed(10),
          stakeVolume24h: breakdown.stakeVolume24h.toFixed(10),
          stakerCount24h: breakdown.stakerCount24h,
          recencyBonus: breakdown.recencyBonus.toFixed(10),
          timeDecay: breakdown.timeDecay.toFixed(10),
        }),
      );
    }

    await this.trendingRepository.save(toSave);

    this.logger.debug(
      `Trending scores updated: ${toSave.length} calls (since ${since.toISOString()})`,
    );

    return { callsProcessed: toSave.length };
  }
}
