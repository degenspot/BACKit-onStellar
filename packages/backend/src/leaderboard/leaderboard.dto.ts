import { IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { LeaderboardPeriod } from './leaderboard-cache.service';

export enum LeaderboardSort {
  PROFIT = 'profit',
  WINRATE = 'winrate',
}

export enum LeaderboardTimeframe {
  ALL = 'all',
  MONTH = 'month',
}

// ─── Legacy PostgreSQL query DTO ─────────────────────────────────────────────

export class LeaderboardQueryDto {
  @ApiPropertyOptional({
    enum: LeaderboardSort,
    default: LeaderboardSort.PROFIT,
  })
  @IsEnum(LeaderboardSort)
  @IsOptional()
  sort: LeaderboardSort = LeaderboardSort.PROFIT;

  @ApiPropertyOptional({
    enum: LeaderboardTimeframe,
    default: LeaderboardTimeframe.ALL,
  })
  @IsEnum(LeaderboardTimeframe)
  @IsOptional()
  timeframe: LeaderboardTimeframe = LeaderboardTimeframe.ALL;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit: number = 20;
}

// ─── Redis period query DTO ───────────────────────────────────────────────────

export class LeaderboardPeriodQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit: number = 20;
}

// ─── Legacy PostgreSQL response DTOs ─────────────────────────────────────────

export class LeaderboardEntryDto {
  @ApiProperty()
  rank: number;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  username: string;

  @ApiProperty({ nullable: true })
  avatarUrl: string | null;

  @ApiProperty()
  totalCalls: number;

  @ApiProperty()
  wonCalls: number;

  @ApiProperty()
  lostCalls: number;

  @ApiProperty({ description: 'Win rate as percentage (0-100)' })
  winRate: number;

  @ApiProperty({ description: 'Net USDC profit' })
  totalProfit: number;
}

export class LeaderboardResponseDto {
  @ApiProperty({ type: [LeaderboardEntryDto] })
  data: LeaderboardEntryDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  pages: number;

  @ApiProperty()
  sort: LeaderboardSort;

  @ApiProperty()
  timeframe: LeaderboardTimeframe;

  @ApiProperty()
  generatedAt: Date;
}

export class UserLeaderboardStatsDto {
  @ApiProperty()
  userId: string;

  @ApiProperty({ nullable: true })
  rank: number | null;

  @ApiProperty()
  totalCalls: number;

  @ApiProperty()
  wonCalls: number;

  @ApiProperty()
  lostCalls: number;

  @ApiProperty()
  winRate: number;

  @ApiProperty()
  totalProfit: number;

  @ApiProperty({
    description:
      'Whether user qualifies for win rate leaderboard (min 5 settled calls)',
  })
  qualifiesForWinRate: boolean;
}

// ─── Redis-backed period response DTOs ───────────────────────────────────────

export class RedisBoardEntryDto {
  @ApiProperty({ description: 'User wallet address' })
  address: string;

  @ApiProperty({ description: 'Composite score (win_rate_bps*1000 + profit)' })
  score: number;

  @ApiProperty({ description: '1-based rank within this period' })
  rank: number;
}

export class RedisBoardResponseDto {
  @ApiProperty({ type: [RedisBoardEntryDto] })
  data: RedisBoardEntryDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  pages: number;

  @ApiProperty({ enum: ['weekly', 'monthly', 'all_time'] })
  period: LeaderboardPeriod;

  @ApiProperty({
    description: 'true = served from Redis, false = PostgreSQL fallback',
  })
  fromCache: boolean;

  @ApiProperty()
  generatedAt: Date;
}

export class ContextualRankDto {
  @ApiProperty({ type: RedisBoardEntryDto })
  user: RedisBoardEntryDto;

  @ApiProperty({ type: [RedisBoardEntryDto] })
  above: RedisBoardEntryDto[];

  @ApiProperty({ type: [RedisBoardEntryDto] })
  below: RedisBoardEntryDto[];

  @ApiProperty({ enum: ['weekly', 'monthly', 'all_time'] })
  period: LeaderboardPeriod;
}
