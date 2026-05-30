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
} from '@nestjs/swagger';
import { LeaderboardService } from './leaderboard.service';
import {
  LeaderboardQueryDto,
  LeaderboardResponseDto,
  UserLeaderboardStatsDto,
} from './leaderboard.dto';

@ApiTags('Leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Get leaderboard',
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
}
