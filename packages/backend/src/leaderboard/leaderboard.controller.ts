import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  ParseUUIDPipe,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { LeaderboardService } from './leaderboard.service';
import {
  LeaderboardQueryDto,
  LeaderboardResponseDto,
  UserLeaderboardStatsDto,
  LeaderboardPeriodQueryDto,
  RedisBoardResponseDto,
  ContextualRankDto,
} from './leaderboard.dto';
import { LeaderboardPeriod } from './leaderboard-cache.service';

@ApiTags('Leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  // ─── Legacy PostgreSQL endpoint (kept for backward compat) ─────────────────

  @Get()
  @ApiOperation({
    summary: 'Get leaderboard (PostgreSQL)',
    description:
      'Returns top traders sorted by profit or win rate. Win rate leaderboard requires minimum 5 settled calls.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: LeaderboardResponseDto })
  async getLeaderboard(
    @Query() query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponseDto> {
    return this.leaderboardService.getLeaderboard(query);
  }

  @Get('users/:userId')
  @ApiOperation({
    summary: "Get a specific user's leaderboard stats",
    description:
      'Returns win rate, total profit, rank, and call history for a user.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: UserLeaderboardStatsDto })
  async getUserStats(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserLeaderboardStatsDto> {
    return this.leaderboardService.getUserStats(userId);
  }

  // ─── Redis-backed real-time endpoints ──────────────────────────────────────

  @Get(':period')
  @ApiOperation({
    summary: 'Get leaderboard by period (Redis-backed, sub-50ms)',
    description:
      'Returns paginated leaderboard from Redis sorted sets. Falls back to PostgreSQL if Redis is unavailable. period = weekly | monthly | all_time',
  })
  @ApiParam({
    name: 'period',
    enum: ['weekly', 'monthly', 'all_time'],
  })
  @ApiResponse({ status: HttpStatus.OK, type: RedisBoardResponseDto })
  async getPeriodLeaderboard(
    @Param('period') period: string,
    @Query() query: LeaderboardPeriodQueryDto,
  ): Promise<RedisBoardResponseDto> {
    const validPeriod = this.parsePeriod(period);
    return this.leaderboardService.getPeriodLeaderboard(
      validPeriod,
      query.page,
      query.limit,
    );
  }

  @Get(':period/around/:address')
  @ApiOperation({
    summary: "Get a user's contextual rank",
    description:
      "Returns the user's rank plus the 5 users above and below them for a given period.",
  })
  @ApiParam({ name: 'period', enum: ['weekly', 'monthly', 'all_time'] })
  @ApiParam({ name: 'address', description: 'Stellar wallet address' })
  @ApiResponse({ status: HttpStatus.OK, type: ContextualRankDto })
  async getContextualRank(
    @Param('period') period: string,
    @Param('address') address: string,
  ): Promise<ContextualRankDto> {
    const validPeriod = this.parsePeriod(period);
    return this.leaderboardService.getContextualRank(validPeriod, address);
  }

  // ─── private helpers ───────────────────────────────────────────────────────

  private parsePeriod(raw: string): LeaderboardPeriod {
    const allowed: LeaderboardPeriod[] = ['weekly', 'monthly', 'all_time'];
    if (allowed.includes(raw as LeaderboardPeriod)) {
      return raw as LeaderboardPeriod;
    }
    return 'all_time';
  }
}
