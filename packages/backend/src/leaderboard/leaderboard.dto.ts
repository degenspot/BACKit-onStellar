import { IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export enum LeaderboardSort {
  PROFIT = 'profit',
  WINRATE = 'winrate',
}

export enum LeaderboardTimeframe {
  ALL = 'all',
  MONTH = 'month',
}

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
