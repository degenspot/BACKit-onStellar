import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsIn,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CallStatus } from '../entities/call.entity';

export type CallsFeedSort = 'recent' | 'trending' | 'ending_soon' | 'most_staked';

export class QueryCallsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['recent', 'trending', 'ending_soon', 'most_staked'])
  sort?: CallsFeedSort = 'recent';

  /**
   * Filter by market status.
   * Accepts a single status value or the special alias "RESOLVED" which maps
   * to RESOLVED_YES | RESOLVED_NO | SETTLING.
   */
  @IsOptional()
  @IsString()
  status?: string;

  /**
   * Filter by token symbol (e.g. "XLM", "BTC").
   */
  @IsOptional()
  @IsString()
  token?: string;

  /**
   * Minimum total pool size (totalYesStake + totalNoStake).
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minStake?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
