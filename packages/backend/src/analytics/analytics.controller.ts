import {
  Controller,
  Get,
  Param,
  Query,
  HttpStatus,
  ValidationPipe,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto, DateRangeFilter } from './dto/analytics-query.dto';
import { UserAnalyticsResponse } from './dto/analytics-response.dto';
import {
  UserStakesQueryDto,
  UserStakesResponseDto,
} from './dto/user-stakes.dto';
import { TotalValueLockedResponseDto } from './dto/tvl.dto';

@ApiTags('Analytics')
@Controller('users')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get(':address/analytics')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300) // 5 minutes
  @ApiOperation({
    summary: 'Get user analytics',
    description:
      'Retrieve comprehensive analytics for a user including cumulative profit, accuracy trends, and win/loss statistics',
  })
  @ApiParam({
    name: 'address',
    description: 'Stellar wallet address of the user',
    example: 'GCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @ApiQuery({
    name: 'range',
    enum: DateRangeFilter,
    required: false,
    description: 'Date range filter (7d, 30d, or all)',
    example: '7d',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User analytics retrieved successfully',
    type: UserAnalyticsResponse,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid address or query parameters',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not found',
  })
  async getUserAnalytics(
    @Param('address') address: string,
    @Query(new ValidationPipe({ transform: true }))
    query: AnalyticsQueryDto,
  ): Promise<UserAnalyticsResponse> {
    const range = query.range || DateRangeFilter.SEVEN_DAYS;
    return this.analyticsService.getUserAnalytics(address, range);
  }

  @Get(':address/stakes')
  @ApiOperation({
    summary: 'Get user stakes ledger',
    description:
      'Retrieve a paginated ledger of a user’s stakes joined with call information and resolution status',
  })
  @ApiParam({
    name: 'address',
    description: 'Stellar wallet address of the user',
    example: 'GCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (1-based)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    example: 20,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User stakes retrieved successfully',
    type: UserStakesResponseDto,
  })
  async getUserStakes(
    @Param('address') address: string,
    @Query(new ValidationPipe({ transform: true }))
    query: UserStakesQueryDto,
  ): Promise<UserStakesResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return this.analyticsService.getUserStakes(address, page, limit);
  }

  /**
   * GET /analytics/:userAddress/tvl
   *
   * Returns the total XLM value locked in all unresolved (Pending) stakes
   * for the given wallet address.
   */
  @Get(':userAddress/tvl')
  @ApiOperation({
    summary: 'Get Total Value Locked',
    description:
      'Sums the amounts of every stake whose underlying call is still PENDING. ' +
      "This represents the user's active capital that has not yet been resolved.",
  })
  @ApiParam({
    name: 'userAddress',
    description: 'Stellar wallet address of the user',
  })
  @ApiResponse({
    status: 200,
    description: 'Total value locked successfully aggregated',
    type: TotalValueLockedResponseDto,
  })
  getTotalValueLocked(
    @Param('userAddress') userAddress: string,
  ): Promise<TotalValueLockedResponseDto> {
    return this.analyticsService.getTotalValueLocked(userAddress);
  }
}
