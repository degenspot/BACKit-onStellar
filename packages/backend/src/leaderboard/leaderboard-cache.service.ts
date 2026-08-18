import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export type LeaderboardPeriod = 'weekly' | 'monthly' | 'all_time';

export interface RedisBoardEntry {
  address: string;
  score: number;
  rank: number;
}

/**
 * Wraps Redis sorted-set operations for the leaderboard.
 *
 * Key layout:
 *   leaderboard:weekly    – reset every Monday 00:00 UTC
 *   leaderboard:monthly   – reset first day of each month 00:00 UTC
 *   leaderboard:all_time  – never reset
 *
 * Score formula (issue spec):
 *   score = win_rate_bps * 1000 + total_profit_xlm / 1_000_000
 *
 * win_rate_bps  = (wonCalls / totalCalls) * 10_000  (0-10000, integers)
 * total_profit_xlm is expressed in stroops (1 XLM = 10_000_000 stroops);
 * dividing by 1_000_000 keeps numbers in a sane integer range.
 */
@Injectable()
export class LeaderboardCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(LeaderboardCacheService.name);
  private readonly redis: Redis;

  // Exposed for testing
  static readonly KEY_PREFIX = 'leaderboard';

  constructor(private readonly configService: ConfigService) {
    const redisUrl =
      this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });

    this.redis.on('error', (err) =>
      this.logger.error('Redis connection error', err.message),
    );
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  // ─── public helpers ────────────────────────────────────────────────────────

  /** Compute the composite Redis score for a user. */
  static computeScore(
    wonCalls: number,
    totalCalls: number,
    totalProfitXlmStroops: number,
  ): number {
    const winRateBps =
      totalCalls > 0 ? Math.round((wonCalls / totalCalls) * 10_000) : 0;
    const profitComponent = Math.floor(totalProfitXlmStroops / 1_000_000);
    return winRateBps * 1_000 + profitComponent;
  }

  static keyFor(period: LeaderboardPeriod): string {
    return `${LeaderboardCacheService.KEY_PREFIX}:${period}`;
  }

  // ─── write ─────────────────────────────────────────────────────────────────

  /** Update (or add) a user's score in every period bucket. */
  async updateScore(
    address: string,
    wonCalls: number,
    totalCalls: number,
    totalProfitXlmStroops: number,
  ): Promise<void> {
    const score = LeaderboardCacheService.computeScore(
      wonCalls,
      totalCalls,
      totalProfitXlmStroops,
    );
    const periods: LeaderboardPeriod[] = ['weekly', 'monthly', 'all_time'];

    const pipeline = this.redis.pipeline();
    for (const period of periods) {
      pipeline.zadd(LeaderboardCacheService.keyFor(period), score, address);
    }
    await pipeline.exec();
  }

  /** Overwrite an entire period's sorted set (used by the cron resync). */
  async bulkSet(
    period: LeaderboardPeriod,
    entries: Array<{ address: string; score: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const key = LeaderboardCacheService.keyFor(period);
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    // ZADD key score member score member ...
    const args: (string | number)[] = [key];
    for (const { address, score } of entries) {
      args.push(score, address);
    }
    // ioredis zadd accepts: zadd(key, ...scoreMembers)
    pipeline.zadd(...(args as [string, ...Array<string | number>]));
    await pipeline.exec();
  }

  // ─── read ──────────────────────────────────────────────────────────────────

  /** Get the top-N entries for a period (0-indexed range). */
  async getTopEntries(
    period: LeaderboardPeriod,
    offset: number,
    count: number,
  ): Promise<RedisBoardEntry[]> {
    const key = LeaderboardCacheService.keyFor(period);
    // ZREVRANGE returns highest-score first
    const raw = await this.redis.zrevrange(
      key,
      offset,
      offset + count - 1,
      'WITHSCORES',
    );
    return this.parseZrevrange(raw, offset);
  }

  /** Total number of members in a period sorted set. */
  async getCount(period: LeaderboardPeriod): Promise<number> {
    return this.redis.zcard(LeaderboardCacheService.keyFor(period));
  }

  /**
   * Return the user's rank (1-based) and the 5 users above and below them.
   * Returns null when Redis has no data for the address.
   */
  async getContextualRanking(
    period: LeaderboardPeriod,
    address: string,
  ): Promise<{
    userEntry: RedisBoardEntry;
    above: RedisBoardEntry[];
    below: RedisBoardEntry[];
  } | null> {
    const key = LeaderboardCacheService.keyFor(period);
    // ZREVRANK gives 0-based rank (highest score = rank 0)
    const zeroBasedRank = await this.redis.zrevrank(key, address);
    if (zeroBasedRank === null) return null;

    const userScore = await this.redis.zscore(key, address);
    const userEntry: RedisBoardEntry = {
      address,
      score: Number(userScore ?? 0),
      rank: zeroBasedRank + 1,
    };

    // 5 above: ranks [rank-5 .. rank-1] (0-indexed: [zeroRank-5 .. zeroRank-1])
    const aboveStart = Math.max(0, zeroBasedRank - 5);
    const aboveEnd = zeroBasedRank - 1; // -1 when user is at position 0
    const aboveRaw =
      zeroBasedRank > 0
        ? await this.redis.zrevrange(key, aboveStart, aboveEnd, 'WITHSCORES')
        : [];

    // 5 below: ranks [rank+1 .. rank+5] (0-indexed: [zeroRank+1 .. zeroRank+5])
    const belowStart = zeroBasedRank + 1;
    const belowEnd = zeroBasedRank + 5;
    const belowRaw = await this.redis.zrevrange(
      key,
      belowStart,
      belowEnd,
      'WITHSCORES',
    );

    return {
      userEntry,
      above: this.parseZrevrange(aboveRaw, aboveStart),
      below: this.parseZrevrange(belowRaw, belowStart),
    };
  }

  /** Check if Redis is reachable. */
  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  // ─── private helpers ───────────────────────────────────────────────────────

  /**
   * Parse ioredis ZREVRANGE WITHSCORES output (alternating member/score pairs)
   * into typed objects.
   */
  private parseZrevrange(raw: string[], offsetRank: number): RedisBoardEntry[] {
    const entries: RedisBoardEntry[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      entries.push({
        address: raw[i],
        score: Number(raw[i + 1]),
        rank: offsetRank + Math.floor(i / 2) + 1,
      });
    }
    return entries;
  }
}
