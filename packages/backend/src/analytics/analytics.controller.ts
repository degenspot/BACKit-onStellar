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

@ApiTags('Analytics')
@Controller('users')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) { }

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
}