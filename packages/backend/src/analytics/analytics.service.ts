import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DateRangeFilter } from './dto/analytics-query.dto';
import {
  UserAnalyticsResponse,
  ProfitDataPoint,
  AccuracyDataPoint,
  WinLossCount,
} from './dto/analytics-response.dto';
import { Call } from './entities/call.entity';
import { Stake } from './entities/stake.entity';

@Injectable()
export class AnalyticsService {
  private readonly platformCache = new Map<string, { data: any; expiresAt: number }>();

  constructor(
    @InjectRepository(Call)
    private readonly callRepository: Repository<Call>,
    @InjectRepository(Stake)
    private readonly stakeRepository: Repository<Stake>,

    private readonly dataSource: DataSource,
  ) {}

  /**
   * Get comprehensive analytics for a user
   * Optimized with single queries per aggregation type
   */
  async getUserAnalytics(
    userAddress: string,
    range: DateRangeFilter,
  ): Promise<UserAnalyticsResponse> {
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

    return {
      cumulativeProfitPerDay: dailyProfitData,
      cumulativeProfitPerWeek: weeklyProfitData,
      accuracyTrend: accuracyData,
      winLossCount: winLossData,
      totalProfitLoss: overallStats.totalProfitLoss,
      overallAccuracy: overallStats.overallAccuracy,
      dateRange: range,
    };
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

  async getPlatformAnalytics(): Promise<any> {
    const cacheKey = 'platform_analytics';
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const [callStats, stakeStats, userStats, tokenPairs] = await Promise.all([
      this.dataSource.query(`
        SELECT
          COUNT(*) AS total_calls_created,
          COUNT(CASE WHEN outcome IN ('YES','NO') THEN 1 END) AS total_calls_resolved,
          AVG(EXTRACT(EPOCH FROM (COALESCE("resolvedAt", NOW()) - "createdAt"))/3600)
            AS avg_call_duration_hours
        FROM calls
      `),
      this.dataSource.query(`
        SELECT
          COALESCE(SUM(amount), 0) AS total_stake_volume,
          COUNT(DISTINCT "userAddress") AS total_unique_users
        FROM stakes
      `),
      this.dataSource.query(`
        SELECT COUNT(DISTINCT "userAddress") AS total_unique_users FROM stakes
      `),
      this.dataSource.query(`
        SELECT "contractAddress" AS token_pair, COUNT(*) AS cnt
        FROM calls
        WHERE "contractAddress" IS NOT NULL
        GROUP BY "contractAddress"
        ORDER BY cnt DESC
        LIMIT 5
      `),
    ]);

    const result = {
      totalCallsCreated: parseInt(callStats[0]?.total_calls_created || 0),
      totalCallsResolved: parseInt(callStats[0]?.total_calls_resolved || 0),
      totalStakeVolume: parseFloat(stakeStats[0]?.total_stake_volume || 0),
      totalUniqueUsers: parseInt(userStats[0]?.total_unique_users || 0),
      averageCallDurationHours: parseFloat(callStats[0]?.avg_call_duration_hours || 0),
      mostPopularTokenPairs: tokenPairs.map((r: any) => ({
        tokenPair: r.token_pair,
        count: parseInt(r.cnt),
      })),
    };

    this.setCache(cacheKey, result, 300);
    return result;
  }

  async getPlatformTrends(period: string): Promise<any> {
    const cacheKey = `platform_trends_${period}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const days = period === '30d' ? 30 : period === '14d' ? 14 : 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [callTrends, userTrends, stakeTrends] = await Promise.all([
      this.dataSource.query(`
        SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*) AS new_calls
        FROM calls
        WHERE "createdAt" >= $1
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY day ASC
      `, [startDate]),
      this.dataSource.query(`
        SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(DISTINCT "userAddress") AS new_users
        FROM stakes
        WHERE "createdAt" >= $1
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY day ASC
      `, [startDate]),
      this.dataSource.query(`
        SELECT DATE_TRUNC('day', "createdAt") AS day, COALESCE(SUM(amount), 0) AS stake_volume
        FROM stakes
        WHERE "createdAt" >= $1
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY day ASC
      `, [startDate]),
    ]);

    const result = {
      period,
      dataPoints: callTrends.map((row: any) => {
        const dayStr = new Date(row.day).toISOString().split('T')[0];
        const userRow = userTrends.find((u: any) => new Date(u.day).toISOString().split('T')[0] === dayStr);
        const stakeRow = stakeTrends.find((s: any) => new Date(s.day).toISOString().split('T')[0] === dayStr);
        return {
          date: dayStr,
          newCalls: parseInt(row.new_calls || 0),
          newUsers: parseInt(userRow?.new_users || 0),
          stakeVolume: parseFloat(stakeRow?.stake_volume || 0),
        };
      }),
    };

    this.setCache(cacheKey, result, 300);
    return result;
  }

  async getUserStakes(
    address: string,
    status?: string,
    page = 1,
    limit = 20,
  ): Promise<any> {
    const offset = (page - 1) * limit;
    const qb = this.stakeRepository
      .createQueryBuilder('stake')
      .leftJoinAndSelect('stake.call', 'call')
      .where('stake.userAddress = :address', { address })
      .orderBy('stake.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    if (status) {
      // Derive status from profitLoss field
      if (status === 'ACTIVE') {
        qb.andWhere('stake.profitLoss IS NULL');
      } else if (status === 'WON') {
        qb.andWhere('stake.profitLoss > 0');
      } else if (status === 'LOST') {
        qb.andWhere('stake.profitLoss < 0');
      } else if (status === 'REFUNDED') {
        qb.andWhere('stake.profitLoss = 0');
      }
    }

    const [stakes, total] = await qb.getManyAndCount();

    const data = stakes.map((stake) => {
      const winPool = stake.position === 'YES' ? Number(stake.call?.totalNoStake || 0) : Number(stake.call?.totalYesStake || 0);
      const stakePool = stake.position === 'YES' ? Number(stake.call?.totalYesStake || 1) : Number(stake.call?.totalNoStake || 1);
      const potentialPayout = stake.profitLoss == null
        ? Number(stake.amount) + (Number(stake.amount) / stakePool) * winPool
        : null;

      const derivedStatus =
        stake.profitLoss == null ? 'ACTIVE' :
        Number(stake.profitLoss) > 0 ? 'WON' :
        Number(stake.profitLoss) < 0 ? 'LOST' : 'REFUNDED';

      return {
        id: stake.id,
        callId: stake.callId,
        stakerAddress: stake.userAddress,
        amount: stake.amount,
        position: stake.position === 'YES' ? 'UP' : 'DOWN',
        status: derivedStatus,
        createdAt: stake.createdAt,
        call: stake.call
          ? {
              title: stake.call.description,
              contractAddress: stake.call.contractAddress,
              outcome: stake.call.outcome,
            }
          : null,
        potentialPayout: potentialPayout ? Number(potentialPayout.toFixed(7)) : null,
      };
    });

    return { data, total, page, limit };
  }

  private getCached(key: string): any | null {
    const entry = this.platformCache.get(key);
    if (entry && Date.now() < entry.expiresAt) return entry.data;
    this.platformCache.delete(key);
    return null;
  }

  private setCache(key: string, data: any, ttlSeconds: number): void {
    this.platformCache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
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
}
