import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  RedisBoardResponseDto,
  RedisBoardEntryDto,
  ContextualRankDto,
} from './leaderboard.dto';
import {
  LeaderboardCacheService,
  LeaderboardPeriod,
} from './leaderboard-cache.service';

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
    private readonly cacheService: LeaderboardCacheService,
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

  // ─── Redis-backed period leaderboard ─────────────────────────────────────

  /**
   * GET /leaderboard/:period?page=&limit=
   * Checks Redis first; falls back to PostgreSQL if Redis is unavailable.
   */
  async getPeriodLeaderboard(
    period: LeaderboardPeriod,
    page: number,
    limit: number,
  ): Promise<RedisBoardResponseDto> {
    const offset = (page - 1) * limit;

    const redisHealthy = await this.cacheService.isHealthy();
    if (redisHealthy) {
      try {
        const [entries, total] = await Promise.all([
          this.cacheService.getTopEntries(period, offset, limit),
          this.cacheService.getCount(period),
        ]);

        // If Redis has data, return it
        if (total > 0 || entries.length > 0) {
          return {
            data: entries,
            total,
            page,
            limit,
            pages: Math.ceil(total / limit),
            period,
            fromCache: true,
            generatedAt: new Date(),
          };
        }
      } catch (err: any) {
        this.logger.warn(
          `Redis read failed, falling back to PostgreSQL: ${err.message}`,
        );
      }
    }

    // PostgreSQL fallback
    return this.getPeriodLeaderboardFromDb(period, page, limit);
  }

  /**
   * GET /leaderboard/:period/around/:address
   * Returns the user's rank plus 5 neighbours above and below.
   * Falls back to PostgreSQL if Redis is unavailable or user not found.
   */
  async getContextualRank(
    period: LeaderboardPeriod,
    address: string,
  ): Promise<ContextualRankDto> {
    const redisHealthy = await this.cacheService.isHealthy();
    if (redisHealthy) {
      try {
        const ctx = await this.cacheService.getContextualRanking(
          period,
          address,
        );
        if (ctx) {
          return {
            user: ctx.userEntry,
            above: ctx.above,
            below: ctx.below,
            period,
          };
        }
      } catch (err: any) {
        this.logger.warn(
          `Redis contextual rank failed for ${address}: ${err.message}`,
        );
      }
    }

    // PostgreSQL fallback — compute rank by profit
    return this.getContextualRankFromDb(period, address);
  }

  // ─── PostgreSQL fallbacks ─────────────────────────────────────────────────

  private async getPeriodLeaderboardFromDb(
    period: LeaderboardPeriod,
    page: number,
    limit: number,
  ): Promise<RedisBoardResponseDto> {
    const offset = (page - 1) * limit;
    const since = this.getSinceForPeriod(period);

    let qb = this.dataSource
      .createQueryBuilder()
      .select('pc.userId', 'address')
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

    qb = qb.groupBy('pc.userId').orderBy('totalProfitUsdc', 'DESC');

    const [rows, totalRaw] = await Promise.all([
      qb.offset(offset).limit(limit).getRawMany(),
      qb
        .select('COUNT(DISTINCT pc.userId)', 'count')
        .offset(undefined as any)
        .limit(undefined as any)
        .getRawOne(),
    ]);

    const total = Number(totalRaw?.count ?? 0);
    const data: RedisBoardEntryDto[] = rows.map((row, i) => ({
      address: row.address,
      score: LeaderboardCacheService.computeScore(
        Number(row.wonCalls),
        Number(row.totalCalls),
        Math.round(Number(row.totalProfitUsdc) * 1_000_000),
      ),
      rank: offset + i + 1,
    }));

    return {
      data,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      period,
      fromCache: false,
      generatedAt: new Date(),
    };
  }

  private async getContextualRankFromDb(
    period: LeaderboardPeriod,
    address: string,
  ): Promise<ContextualRankDto> {
    const since = this.getSinceForPeriod(period);

    // Get all users sorted by profit descending
    let qb = this.dataSource
      .createQueryBuilder()
      .select('pc.userId', 'address')
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
      address: string;
      totalCalls: string;
      wonCalls: string;
      totalProfitUsdc: string;
    }> = await qb
      .groupBy('pc.userId')
      .orderBy('totalProfitUsdc', 'DESC')
      .getRawMany();

    const toEntry = (
      row: (typeof rows)[0],
      rank: number,
    ): RedisBoardEntryDto => ({
      address: row.address,
      score: LeaderboardCacheService.computeScore(
        Number(row.wonCalls),
        Number(row.totalCalls),
        Math.round(Number(row.totalProfitUsdc) * 1_000_000),
      ),
      rank,
    });

    const userIndex = rows.findIndex((r) => r.address === address);
    if (userIndex === -1) {
      throw new NotFoundException(
        `Address ${address} not found in leaderboard`,
      );
    }

    const userEntry = toEntry(rows[userIndex], userIndex + 1);
    const above = rows
      .slice(Math.max(0, userIndex - 5), userIndex)
      .map((r, i) => toEntry(r, Math.max(1, userIndex - 5) + i + 1));
    const below = rows
      .slice(userIndex + 1, userIndex + 6)
      .map((r, i) => toEntry(r, userIndex + 2 + i));

    return { user: userEntry, above, below, period };
  }

  private getSinceForPeriod(period: LeaderboardPeriod): Date | null {
    const now = new Date();
    if (period === 'weekly') {
      const d = new Date(now);
      d.setUTCHours(0, 0, 0, 0);
      const day = d.getUTCDay();
      d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
      return d;
    }
    if (period === 'monthly') {
      const d = new Date(now);
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(1);
      return d;
    }
    return null; // all_time
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
