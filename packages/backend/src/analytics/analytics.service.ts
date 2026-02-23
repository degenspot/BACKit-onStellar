import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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

    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) { }

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
}
