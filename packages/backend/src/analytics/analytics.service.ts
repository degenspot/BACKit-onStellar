import { InjectRepository } from '@nestjs/typeorm';
import { TotalValueLockedResponseDto } from './dto/tvl.dto';
import { TokensService } from '../token/tokens.service';
import { CoinGeckoService } from '../oracle/coinGeko.service';
import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Inject, Logger } from '@nestjs/common';
import { DateRangeFilter } from './dto/analytics-query.dto';
import {
  UserAnalyticsResponse,
  ProfitDataPoint,
  AccuracyDataPoint,
  WinLossCount,
} from './dto/analytics-response.dto';
import {
  StakeLedgerItemDto,
  UserStakesResponseDto,
} from './dto/user-stakes.dto';
import { Call } from './entities/call.entity';
import { Stake } from './entities/stake.entity';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(Call)
    private readonly callRepository: Repository<Call>,
    @InjectRepository(Stake)
    private readonly stakeRepository: Repository<Stake>,
    @InjectRepository(Stake)
    private readonly stakeLedgerRepository: Repository<Stake>,

    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly tokensService: TokensService,
    private readonly coinGeckoService: CoinGeckoService,
  ) {}

  /**
   * Get a paginated ledger of a user's stakes joined with call info.
   */
  async getUserStakes(
    userAddress: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<UserStakesResponseDto> {
    const qb = this.stakeRepository
      .createQueryBuilder('stake')
      .leftJoinAndSelect('stake.call', 'call')
      .where('stake.userAddress = :userAddress', { userAddress })
      .orderBy('stake.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [stakes, total] = await qb.getManyAndCount();

    const data: StakeLedgerItemDto[] = stakes.map((stake) => {
      const call = stake.call;

      const resolutionStatus: 'PENDING' | 'RESOLVED' =
        call && call.outcome && call.outcome !== 'PENDING'
          ? 'RESOLVED'
          : 'PENDING';

      return {
        id: stake.id,
        callId: stake.callId,
        userAddress: stake.userAddress,
        amount: Number(stake.amount),
        position: stake.position,
        profitLoss:
          stake.profitLoss === null || stake.profitLoss === undefined
            ? null
            : Number(stake.profitLoss),
        transactionHash: stake.transactionHash ?? null,
        createdAt: stake.createdAt,
        updatedAt: stake.updatedAt,
        resolutionStatus,
        call: call && {
          id: call.id,
          title: call.title,
          description: call.description,
          outcome: call.outcome,
          resolvedAt: call.resolvedAt ?? null,
          expiresAt: call.expiresAt ?? null,
          createdAt: call.createdAt,
          contractAddress: call.contractAddress ?? null,
          totalYesStake: Number(call.totalYesStake ?? 0),
          totalNoStake: Number(call.totalNoStake ?? 0),
        },
      };
    });

    return {
      data,
      total,
      page,
      limit,
    };
  }

  /**
   * Get comprehensive analytics for a user
   * Optimized with single queries per aggregation type
   */
  async getUserAnalytics(
    userAddress: string,
    range: DateRangeFilter,
  ): Promise<UserAnalyticsResponse> {
    const cacheKey = `profile:${userAddress}:${range}`;
    const cachedData =
      await this.cacheManager.get<UserAnalyticsResponse>(cacheKey);

    if (cachedData) {
      this.logger.debug(`Returning cached analytics for ${userAddress}`);
      return cachedData;
    }

    const { startDate, endDate } = this.getDateRange(range);

    // Execute all queries in parallel for better performance
    const [
      dailyProfitData,
      weeklyProfitData,
      accuracyData,
      winLossData,
      overallStats,
    ] = await Promise.all([
      this.getCumulativeProfitPerDay(userAddress, startDate, endDate),
      this.getCumulativeProfitPerWeek(userAddress, startDate, endDate),
      this.getAccuracyTrend(userAddress, startDate, endDate),
      this.getWinLossCount(userAddress, startDate, endDate),
      this.getOverallStats(userAddress, startDate, endDate),
    ]);

    const response: UserAnalyticsResponse = {
      cumulativeProfitPerDay: dailyProfitData,
      cumulativeProfitPerWeek: weeklyProfitData,
      accuracyTrend: accuracyData,
      winLossCount: winLossData,
      totalProfitLoss: overallStats.totalProfitLoss,
      overallAccuracy: overallStats.overallAccuracy,
      dateRange: range,
    };

    await this.cacheManager.set(cacheKey, response, 300000); // 300s = 5m
    return response;
  }

  /**
   * Calculate cumulative profit per day
   * Uses a single optimized query with date_trunc aggregation
   */
  private async getCumulativeProfitPerDay(
    userAddress: string,
    startDate: Date,
    endDate: Date,
  ): Promise<ProfitDataPoint[]> {
    const rawData = await this.stakeRepository
      .createQueryBuilder('stake')
      .select("DATE_TRUNC('day', stake.createdAt)", 'date')
      .addSelect('SUM(COALESCE(stake.profitLoss, 0))', 'dailyProfit')
      .where('stake.userAddress = :userAddress', { userAddress })
      .andWhere('stake.createdAt >= :startDate', { startDate })
      .andWhere('stake.createdAt <= :endDate', { endDate })
      .groupBy("DATE_TRUNC('day', stake.createdAt)")
      .orderBy("DATE_TRUNC('day', stake.createdAt)", 'ASC')
      .getRawMany();

    // Convert to cumulative values
    let cumulative = 0;
    const dataPoints: ProfitDataPoint[] = rawData.map((row) => {
      cumulative += parseFloat(row.dailyProfit || 0);
      return {
        date: new Date(row.date).toISOString().split('T')[0],
        value: Number(cumulative.toFixed(7)), // Stellar precision
      };
    });

    // Fill in missing dates with previous cumulative value
    return this.fillMissingDates(dataPoints, startDate, endDate, 'day');
  }

  /**
   * Calculate cumulative profit per week
   * Uses a single optimized query with date_trunc aggregation
   */
  private async getCumulativeProfitPerWeek(
    userAddress: string,
    startDate: Date,
    endDate: Date,
  ): Promise<ProfitDataPoint[]> {
    const rawData = await this.stakeRepository
      .createQueryBuilder('stake')
      .select("DATE_TRUNC('week', stake.createdAt)", 'date')
      .addSelect('SUM(COALESCE(stake.profitLoss, 0))', 'weeklyProfit')
      .where('stake.userAddress = :userAddress', { userAddress })
      .andWhere('stake.createdAt >= :startDate', { startDate })
      .andWhere('stake.createdAt <= :endDate', { endDate })
      .groupBy("DATE_TRUNC('week', stake.createdAt)")
      .orderBy("DATE_TRUNC('week', stake.createdAt)", 'ASC')
      .getRawMany();

    // Convert to cumulative values
    let cumulative = 0;
    const dataPoints: ProfitDataPoint[] = rawData.map((row) => {
      cumulative += parseFloat(row.weeklyProfit || 0);
      return {
        date: new Date(row.date).toISOString().split('T')[0],
        value: Number(cumulative.toFixed(7)),
      };
    });

    return this.fillMissingDates(dataPoints, startDate, endDate, 'week');
  }

  /**
   * Calculate accuracy trend over time
   * Single query using window functions for rolling accuracy
   */
  private async getAccuracyTrend(
    userAddress: string,
    startDate: Date,
    endDate: Date,
  ): Promise<AccuracyDataPoint[]> {
    const rawData = await this.callRepository
      .createQueryBuilder('call')
      .leftJoin('stake', 'stake', 'stake.callId = call.id')
      .select("DATE_TRUNC('day', call.resolvedAt)", 'date')
      .addSelect(
        `COUNT(CASE WHEN (stake.position = call.outcome) THEN 1 END)`,
        'correct',
      )
      .addSelect('COUNT(*)', 'total')
      .where('stake.userAddress = :userAddress', { userAddress })
      .andWhere('call.outcome IN (:...outcomes)', { outcomes: ['YES', 'NO'] })
      .andWhere('call.resolvedAt >= :startDate', { startDate })
      .andWhere('call.resolvedAt <= :endDate', { endDate })
      .groupBy("DATE_TRUNC('day', call.resolvedAt)")
      .orderBy("DATE_TRUNC('day', call.resolvedAt)", 'ASC')
      .getRawMany();

    // Calculate rolling accuracy
    let totalCorrect = 0;
    let totalResolved = 0;

    const dataPoints: AccuracyDataPoint[] = rawData.map((row) => {
      totalCorrect += parseInt(row.correct || 0);
      totalResolved += parseInt(row.total || 0);

      const accuracy =
        totalResolved > 0 ? (totalCorrect / totalResolved) * 100 : 0;

      return {
        date: new Date(row.date).toISOString().split('T')[0],
        value: Number(accuracy.toFixed(2)),
      };
    });

    return this.fillMissingDates(dataPoints, startDate, endDate, 'day', true);
  }

  /**
   * Get win/loss counts
   * Single optimized query with conditional aggregation
   */
  private async getWinLossCount(
    userAddress: string,
    startDate: Date,
    endDate: Date,
  ): Promise<WinLossCount> {
    const result = await this.callRepository
      .createQueryBuilder('call')
      .leftJoin('stake', 'stake', 'stake.callId = call.id')
      .select(
        `COUNT(CASE WHEN stake.position = call.outcome AND call.outcome IN ('YES', 'NO') THEN 1 END)`,
        'wins',
      )
      .addSelect(
        `COUNT(CASE WHEN stake.position != call.outcome AND call.outcome IN ('YES', 'NO') THEN 1 END)`,
        'losses',
      )
      .addSelect(
        `COUNT(CASE WHEN call.outcome = 'PENDING' THEN 1 END)`,
        'pending',
      )
      .addSelect('COUNT(*)', 'total')
      .where('stake.userAddress = :userAddress', { userAddress })
      .andWhere('stake.createdAt >= :startDate', { startDate })
      .andWhere('stake.createdAt <= :endDate', { endDate })
      .getRawOne();

    return {
      wins: parseInt(result?.wins || 0),
      losses: parseInt(result?.losses || 0),
      pending: parseInt(result?.pending || 0),
      total: parseInt(result?.total || 0),
    };
  }

  /**
   * Get overall statistics (total P/L and accuracy)
   * Single query for both metrics
   */
  private async getOverallStats(
    userAddress: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ totalProfitLoss: number; overallAccuracy: number }> {
    const profitResult = await this.stakeRepository
      .createQueryBuilder('stake')
      .select('SUM(COALESCE(stake.profitLoss, 0))', 'totalProfitLoss')
      .where('stake.userAddress = :userAddress', { userAddress })
      .andWhere('stake.createdAt >= :startDate', { startDate })
      .andWhere('stake.createdAt <= :endDate', { endDate })
      .getRawOne();

    const accuracyResult = await this.callRepository
      .createQueryBuilder('call')
      .leftJoin('stake', 'stake', 'stake.callId = call.id')
      .select(
        `COUNT(CASE WHEN stake.position = call.outcome THEN 1 END)`,
        'correct',
      )
      .addSelect('COUNT(*)', 'total')
      .where('stake.userAddress = :userAddress', { userAddress })
      .andWhere('call.outcome IN (:...outcomes)', { outcomes: ['YES', 'NO'] })
      .andWhere('call.resolvedAt >= :startDate', { startDate })
      .andWhere('call.resolvedAt <= :endDate', { endDate })
      .getRawOne();

    const totalProfitLoss = parseFloat(profitResult?.totalProfitLoss || 0);
    const correct = parseInt(accuracyResult?.correct || 0);
    const total = parseInt(accuracyResult?.total || 0);
    const overallAccuracy = total > 0 ? (correct / total) * 100 : 0;

    return {
      totalProfitLoss: Number(totalProfitLoss.toFixed(7)),
      overallAccuracy: Number(overallAccuracy.toFixed(2)),
    };
  }

  /**
   * Helper: Get date range based on filter
   */
  private getDateRange(range: DateRangeFilter): {
    startDate: Date;
    endDate: Date;
  } {
    const endDate = new Date();
    let startDate = new Date();

    switch (range) {
      case DateRangeFilter.SEVEN_DAYS:
        startDate.setDate(endDate.getDate() - 7);
        break;
      case DateRangeFilter.THIRTY_DAYS:
        startDate.setDate(endDate.getDate() - 30);
        break;
      case DateRangeFilter.ALL:
        startDate = new Date(0); // Unix epoch
        break;
    }

    return { startDate, endDate };
  }

  /**
   * Helper: Fill missing dates in time series data
   * Ensures continuous data points for charting
   */
  private fillMissingDates<T extends { date: string; value: number }>(
    dataPoints: T[],
    startDate: Date,
    endDate: Date,
    interval: 'day' | 'week',
    maintainLastValue: boolean = true,
  ): T[] {
    if (dataPoints.length === 0) return [];

    const filledData: T[] = [];
    const existingDatesMap = new Map(dataPoints.map((dp) => [dp.date, dp]));

    const currentDate = new Date(startDate);
    let lastValue = 0;

    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];

      if (existingDatesMap.has(dateStr)) {
        const dataPoint = existingDatesMap.get(dateStr)!;
        filledData.push(dataPoint);
        lastValue = dataPoint.value;
      } else if (maintainLastValue) {
        filledData.push({
          date: dateStr,
          value: lastValue,
        } as T);
      }

      // Increment date based on interval
      if (interval === 'day') {
        currentDate.setDate(currentDate.getDate() + 1);
      } else {
        currentDate.setDate(currentDate.getDate() + 7);
      }
    }

    return filledData;
  }

  async calculatePredictorReliability(userId: string): Promise<number> {
    const result = await this.dataSource.query(
      `
      SELECT 
        COALESCE(
          SUM(CASE WHEN c.outcome = 'WIN' THEN 1 ELSE 0 END)::float 
          / NULLIF(COUNT(c.id), 0),
          0
        ) AS win_rate,
        COALESCE(SUM(c.volume), 0) AS total_volume
      FROM call c
      WHERE c."userId" = $1
      `,
      [userId],
    );

    const winRate = Number(result[0]?.win_rate || 0);
    const totalVolume = Number(result[0]?.total_volume || 0);

    // Normalize volume (optional basic scaling to avoid extreme values)
    const normalizedVolume = totalVolume > 0 ? Math.log10(totalVolume + 1) : 0;

    const reputation = winRate * 0.7 + normalizedVolume * 0.3;

    return Number(reputation.toFixed(4));
  }

  async calculateReputationScore(userAddress: string): Promise<number> {
    const stats = await this.dataSource.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE c.outcome IN ('YES', 'NO'))::int AS resolved_calls,
        COUNT(*) FILTER (
          WHERE c.outcome IN ('YES', 'NO') AND s.position = c.outcome
        )::int AS wins,
        COALESCE(SUM(s.amount), 0)::numeric AS total_volume
      FROM stakes s
      JOIN calls c ON c.id = s."callId"
      WHERE s."userAddress" = $1
      `,
      [userAddress],
    );

    const row = stats[0] ?? {
      resolved_calls: 0,
      wins: 0,
      total_volume: 0,
    };

    const resolvedCalls = Number(row.resolved_calls || 0);
    const wins = Number(row.wins || 0);
    const totalVolume = Number(row.total_volume || 0);
    const winRate = resolvedCalls > 0 ? wins / resolvedCalls : 0;

    const medianResult = await this.dataSource.query(
      `
      SELECT COALESCE(
        percentile_cont(0.5) WITHIN GROUP (ORDER BY user_volume),
        0
      ) AS median_volume
      FROM (
        SELECT COALESCE(SUM(amount), 0)::numeric AS user_volume
        FROM stakes
        GROUP BY "userAddress"
      ) volumes
      `,
    );

    const medianVolume = Number(medianResult[0]?.median_volume || 0);
    const volumeScore =
      medianVolume > 0 ? Math.min(1, totalVolume / medianVolume) : 0;

    const activityRows = await this.dataSource.query(
      `
      SELECT DISTINCT DATE_TRUNC('week', s."createdAt")::date AS week_start
      FROM stakes s
      WHERE s."userAddress" = $1
      ORDER BY week_start ASC
      `,
      [userAddress],
    );

    const weeks: Date[] = activityRows.map((r: { week_start: string }) => {
      return new Date(r.week_start);
    });
    const activeWeeks = weeks.length;

    let longestStreak = 0;
    let currentStreak = 0;
    let prevWeekTime = 0;
    for (const week of weeks) {
      const currentTime = week.getTime();
      if (
        prevWeekTime &&
        currentTime - prevWeekTime === 7 * 24 * 60 * 60 * 1000
      ) {
        currentStreak += 1;
      } else {
        currentStreak = 1;
      }
      longestStreak = Math.max(longestStreak, currentStreak);
      prevWeekTime = currentTime;
    }

    const consistencyScore = Math.min(
      1,
      (Math.min(longestStreak, 8) / 8) * 0.7 +
        (Math.min(activeWeeks, 12) / 12) * 0.3,
    );

    const confidenceMultiplier =
      resolvedCalls >= 10 ? 1 : 0.3 + (resolvedCalls / 10) * 0.7;

    const score =
      (winRate * 0.4 + volumeScore * 0.3 + consistencyScore * 0.3) *
      confidenceMultiplier *
      100;

    return Number(score.toFixed(2));
  }

  /**
   * Aggregates a user's active Portfolio "Total Value Locked".
   *
   * Loops over every Stake row where:
   *   - userAddress matches the caller
   *   - the parent Call has status OPEN or SETTLING
   *
   * Returns the USDC sum of those amounts, a count, and a breakdown.
   */
  async getTotalValueLocked(
    userAddress: string,
  ): Promise<TotalValueLockedResponseDto> {
    const stakes = await this.stakeLedgerRepository
      .createQueryBuilder('stake')
      .innerJoinAndSelect('stake.call', 'call')
      .where('stake.userAddress = :userAddress', { userAddress })
      .andWhere('call.status IN (:...statuses)', {
        statuses: ['OPEN', 'SETTLING'],
      })
      .getMany();

    if (!stakes.length) {
      return {
        userAddress,
        totalValueLocked: 0,
        pendingStakesCount: 0,
        breakdown: [],
      };
    }

    // Get all active tokens to map addresses to symbols
    const tokens = await this.tokensService.getAll();
    const tokenMap = new Map(
      tokens.map((t) => [t.assetIssuer || t.assetCode, t.assetCode]),
    );

    // Identify unique symbols needed for price lookup
    const symbolsToFetch = new Set<string>();
    stakes.forEach((stake) => {
      const stakeToken = stake.call.stakeToken;
      const symbol = stakeToken ? tokenMap.get(stakeToken) || 'XLM' : 'XLM'; // fallback
      symbolsToFetch.add(symbol);
    });

    // Fetch prices in USD
    const prices = await this.coinGeckoService.getPrices(
      Array.from(symbolsToFetch),
    );

    let totalLocked = 0;
    const breakdown = stakes.map((stake) => {
      const call = stake.call;
      const stakeToken = call.stakeToken;
      const tokenSymbol = stakeToken
        ? tokenMap.get(stakeToken) || 'XLM'
        : 'XLM';
      const usdPrice = prices.get(tokenSymbol) || 0; // Default to 0 if price missing

      const amount = Number(stake.amount);
      const usdValue = amount * usdPrice;
      totalLocked += usdValue;

      // Calculate potential win
      const totalYes = Number(call.totalYesStake || 0);
      const totalNo = Number(call.totalNoStake || 0);
      const poolSize = stake.position === 'YES' ? totalYes : totalNo;
      const totalPool = totalYes + totalNo;

      let potentialWin = 0;
      if (poolSize > 0) {
        potentialWin = (amount / poolSize) * totalPool;
      }
      const potentialWinUsd = potentialWin * usdPrice;

      return {
        callId: call.id,
        amount: Number(usdValue.toFixed(2)),
        position: stake.position,
        tokenSymbol,
        potentialWin: Number(potentialWinUsd.toFixed(2)),
      };
    });

    return {
      userAddress,
      totalValueLocked: Number(totalLocked.toFixed(2)),
      pendingStakesCount: stakes.length,
      breakdown,
    };
  }

  // ─── Platform Analytics (#195) ───────────────────────────────────────────

  private readonly platformCache = new Map<
    string,
    { data: any; expiresAt: number }
  >();

  async getPlatformAnalytics(): Promise<any> {
    const key = 'platform_analytics';
    const hit = this.getCache(key);
    if (hit) return hit;

    const [callStats, stakeStats, userStats, tokenPairs] = await Promise.all([
      this.dataSource.query(`
        SELECT COUNT(*) AS total_calls_created,
               COUNT(CASE WHEN outcome IN ('YES','NO') THEN 1 END) AS total_calls_resolved,
               AVG(EXTRACT(EPOCH FROM (COALESCE("resolvedAt",NOW())-"createdAt"))/3600) AS avg_call_duration_hours
        FROM calls`),
      this.dataSource.query(
        `SELECT COALESCE(SUM(amount),0) AS total_stake_volume FROM stakes`,
      ),
      this.dataSource.query(
        `SELECT COUNT(DISTINCT "userAddress") AS total_unique_users FROM stakes`,
      ),
      this.dataSource.query(`
        SELECT "contractAddress" AS token_pair, COUNT(*) AS cnt
        FROM calls WHERE "contractAddress" IS NOT NULL
        GROUP BY "contractAddress" ORDER BY cnt DESC LIMIT 5`),
    ]);

    const result = {
      totalCallsCreated: parseInt(callStats[0]?.total_calls_created ?? 0),
      totalCallsResolved: parseInt(callStats[0]?.total_calls_resolved ?? 0),
      totalStakeVolume: parseFloat(stakeStats[0]?.total_stake_volume ?? 0),
      totalUniqueUsers: parseInt(userStats[0]?.total_unique_users ?? 0),
      averageCallDurationHours: parseFloat(
        callStats[0]?.avg_call_duration_hours ?? 0,
      ),
      mostPopularTokenPairs: (tokenPairs as any[]).map((r) => ({
        tokenPair: r.token_pair,
        count: parseInt(r.cnt),
      })),
    };

    this.setCache(key, result, 300);
    return result;
  }

  async getPlatformTrends(period: string): Promise<any> {
    const key = `platform_trends_${period}`;
    const hit = this.getCache(key);
    if (hit) return hit;

    const days = period === '30d' ? 30 : period === '14d' ? 14 : 7;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [callTrends, userTrends, stakeTrends] = await Promise.all([
      this.dataSource.query(
        `SELECT DATE_TRUNC('day',"createdAt") AS day, COUNT(*) AS new_calls
         FROM calls WHERE "createdAt">=$1 GROUP BY 1 ORDER BY 1`,
        [since],
      ),
      this.dataSource.query(
        `SELECT DATE_TRUNC('day',"createdAt") AS day, COUNT(DISTINCT "userAddress") AS new_users
         FROM stakes WHERE "createdAt">=$1 GROUP BY 1 ORDER BY 1`,
        [since],
      ),
      this.dataSource.query(
        `SELECT DATE_TRUNC('day',"createdAt") AS day, COALESCE(SUM(amount),0) AS stake_volume
         FROM stakes WHERE "createdAt">=$1 GROUP BY 1 ORDER BY 1`,
        [since],
      ),
    ]);

    const result = {
      period,
      dataPoints: (callTrends as any[]).map((row) => {
        const d = new Date(row.day).toISOString().split('T')[0];
        const u = (userTrends as any[]).find(
          (r) => new Date(r.day).toISOString().split('T')[0] === d,
        );
        const s = (stakeTrends as any[]).find(
          (r) => new Date(r.day).toISOString().split('T')[0] === d,
        );
        return {
          date: d,
          newCalls: parseInt(row.new_calls ?? 0),
          newUsers: parseInt(u?.new_users ?? 0),
          stakeVolume: parseFloat(s?.stake_volume ?? 0),
        };
      }),
    };

    this.setCache(key, result, 300);
    return result;
  }

  private getCache(key: string): any | null {
    const e = this.platformCache.get(key);
    if (e && Date.now() < e.expiresAt) return e.data;
    this.platformCache.delete(key);
    return null;
  }

  private setCache(key: string, data: any, ttlSeconds: number): void {
    this.platformCache.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
}
