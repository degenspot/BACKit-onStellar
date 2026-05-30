import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  PredictionCall,
  CallStatus,
  CallOutcome,
  LeaderboardSnapshot,
} from './leaderboard.entity';
import {
  LeaderboardQueryDto,
  LeaderboardSort,
  LeaderboardTimeframe,
  LeaderboardEntryDto,
  LeaderboardResponseDto,
  UserLeaderboardStatsDto,
} from './leaderboard.dto';

const MIN_CALLS_FOR_WINRATE = 5;

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  constructor(
    @InjectRepository(PredictionCall)
    private readonly callRepo: Repository<PredictionCall>,
    @InjectRepository(LeaderboardSnapshot)
    private readonly snapshotRepo: Repository<LeaderboardSnapshot>,
    private readonly dataSource: DataSource,
  ) {}

  async getLeaderboard(
    query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponseDto> {
    const { sort, timeframe, page, limit } = query;
    const offset = (page - 1) * limit;

    const dateFilter = this.getDateFilter(timeframe);

    // Build raw SQL for performance with indexed columns
    let qb = this.dataSource
      .createQueryBuilder()
      .select('pc.userId', 'userId')
      .addSelect('COUNT(*)', 'totalCalls')
      .addSelect(
        `SUM(CASE WHEN pc.outcome = '${CallOutcome.WON}' THEN 1 ELSE 0 END)`,
        'wonCalls',
      )
      .addSelect(
        `SUM(CASE WHEN pc.outcome = '${CallOutcome.LOST}' THEN 1 ELSE 0 END)`,
        'lostCalls',
      )
      .addSelect(
        `ROUND(
          (SUM(CASE WHEN pc.outcome = '${CallOutcome.WON}' THEN 1 ELSE 0 END) * 100.0) / NULLIF(COUNT(*), 0),
          2
        )`,
        'winRate',
      )
      .addSelect('COALESCE(SUM(pc.profitUsdc), 0)', 'totalProfit')
      .from(PredictionCall, 'pc')
      .where('pc.status = :status', { status: CallStatus.SETTLED });

    if (dateFilter) {
      qb = qb.andWhere('pc.settledAt >= :since', { since: dateFilter });
    }

    qb = qb.groupBy('pc.userId');

    // Apply minimum calls filter for win rate leaderboard
    if (sort === LeaderboardSort.WINRATE) {
      qb = qb.having('COUNT(*) >= :minCalls', {
        minCalls: MIN_CALLS_FOR_WINRATE,
      });
      qb = qb.orderBy('winRate', 'DESC').addOrderBy('totalProfit', 'DESC');
    } else {
      qb = qb.orderBy('totalProfit', 'DESC').addOrderBy('winRate', 'DESC');
    }

    const [rawData, total] = await Promise.all([
      qb.offset(offset).limit(limit).getRawMany(),
      this.getTotalCount(sort, timeframe),
    ]);

    if (rawData.length === 0) {
      return this.emptyResponse(query, 0);
    }

    // Enrich with user info (in production, join with users table)
    const data: LeaderboardEntryDto[] = rawData.map((row, index) => ({
      rank: offset + index + 1,
      userId: row.userId,
      username: row.username ?? `User ${row.userId.slice(0, 8)}`,
      avatarUrl: row.avatarUrl ?? null,
      totalCalls: Number(row.totalCalls),
      wonCalls: Number(row.wonCalls),
      lostCalls: Number(row.lostCalls),
      winRate: Number(row.winRate ?? 0),
      totalProfit: Number(row.totalProfit ?? 0),
    }));

    return {
      data,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      sort,
      timeframe,
      generatedAt: new Date(),
    };
  }

  async getUserStats(userId: string): Promise<UserLeaderboardStatsDto> {
    const result = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'totalCalls')
      .addSelect(
        `SUM(CASE WHEN pc.outcome = '${CallOutcome.WON}' THEN 1 ELSE 0 END)`,
        'wonCalls',
      )
      .addSelect(
        `SUM(CASE WHEN pc.outcome = '${CallOutcome.LOST}' THEN 1 ELSE 0 END)`,
        'lostCalls',
      )
      .addSelect(
        `ROUND(
          (SUM(CASE WHEN pc.outcome = '${CallOutcome.WON}' THEN 1 ELSE 0 END) * 100.0) / NULLIF(COUNT(*), 0),
          2
        )`,
        'winRate',
      )
      .addSelect('COALESCE(SUM(pc.profitUsdc), 0)', 'totalProfit')
      .from(PredictionCall, 'pc')
      .where('pc.userId = :userId', { userId })
      .andWhere('pc.status = :status', { status: CallStatus.SETTLED })
      .getRawOne();

    const totalCalls = Number(result?.totalCalls ?? 0);
    const wonCalls = Number(result?.wonCalls ?? 0);
    const lostCalls = Number(result?.lostCalls ?? 0);
    const winRate = Number(result?.winRate ?? 0);
    const totalProfit = Number(result?.totalProfit ?? 0);

    // Get profit rank
    const profitRankResult = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'rank')
      .from((subQuery) => {
        return subQuery
          .select('userId')
          .addSelect('SUM(profitUsdc)', 'totalProfit')
          .from(PredictionCall, 'pc')
          .where('pc.status = :status', { status: CallStatus.SETTLED })
          .groupBy('pc.userId')
          .having('SUM(pc.profitUsdc) > :userProfit', {
            userProfit: totalProfit,
          });
      }, 'ranked')
      .getRawOne();

    const rank =
      totalCalls > 0 ? Number(profitRankResult?.rank ?? 0) + 1 : null;

    return {
      userId,
      rank,
      totalCalls,
      wonCalls,
      lostCalls,
      winRate,
      totalProfit,
      qualifiesForWinRate: totalCalls >= MIN_CALLS_FOR_WINRATE,
    };
  }

  private async getTotalCount(
    sort: LeaderboardSort,
    timeframe: LeaderboardTimeframe,
  ): Promise<number> {
    const dateFilter = this.getDateFilter(timeframe);

    const qb = this.dataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT sub.userId)', 'count')
      .from((subQuery) => {
        let inner = subQuery
          .select('pc.userId', 'userId')
          .addSelect('COUNT(*)', 'totalCalls')
          .from(PredictionCall, 'pc')
          .where('pc.status = :status', { status: CallStatus.SETTLED });

        if (dateFilter) {
          inner = inner.andWhere('pc.settledAt >= :since', {
            since: dateFilter,
          });
        }

        inner = inner.groupBy('pc.userId');

        if (sort === LeaderboardSort.WINRATE) {
          inner = inner.having('COUNT(*) >= :minCalls', {
            minCalls: MIN_CALLS_FOR_WINRATE,
          });
        }

        return inner;
      }, 'sub');

    const result = await qb.getRawOne();
    return Number(result?.count ?? 0);
  }

  private getDateFilter(timeframe: LeaderboardTimeframe): Date | null {
    if (timeframe === LeaderboardTimeframe.MONTH) {
      const since = new Date();
      since.setMonth(since.getMonth() - 1);
      return since;
    }
    return null;
  }

  private emptyResponse(
    query: LeaderboardQueryDto,
    total: number,
  ): LeaderboardResponseDto {
    return {
      data: [],
      total,
      page: query.page,
      limit: query.limit,
      pages: 0,
      sort: query.sort,
      timeframe: query.timeframe,
      generatedAt: new Date(),
    };
  }
}
