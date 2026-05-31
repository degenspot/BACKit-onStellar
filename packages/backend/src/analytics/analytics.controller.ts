import {
  Controller,
  Get,
  Param,
  Query,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { IsOptional, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto, DateRangeFilter } from './dto/analytics-query.dto';
import { UserAnalyticsResponse } from './dto/analytics-response.dto';

class StakesQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'WON', 'LOST', 'REFUNDED'])
  status?: string;

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

class TrendsQueryDto {
  @IsOptional()
  @IsIn(['7d', '14d', '30d'])
  period?: string = '7d';
}

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('platform')
  @ApiOperation({ summary: 'Get platform-wide aggregate metrics' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Platform analytics retrieved' })
  getPlatformAnalytics() {
    return this.analyticsService.getPlatformAnalytics();
  }

  @Get('platform/trends')
  @ApiOperation({ summary: 'Get daily trend data points for the platform' })
  @ApiQuery({ name: 'period', enum: ['7d', '14d', '30d'], required: false })
  @ApiResponse({ status: HttpStatus.OK, description: 'Platform trends retrieved' })
  getPlatformTrends(
    @Query(new ValidationPipe({ transform: true })) query: TrendsQueryDto,
  ) {
    return this.analyticsService.getPlatformTrends(query.period ?? '7d');
  }
}

@ApiTags('Analytics')
@Controller('users')
export class UserAnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get(':address/analytics')
  @ApiOperation({ summary: 'Get user analytics' })
  @ApiParam({ name: 'address', description: 'Stellar wallet address' })
  @ApiQuery({ name: 'range', enum: DateRangeFilter, required: false })
  @ApiResponse({ status: HttpStatus.OK, type: UserAnalyticsResponse })
  async getUserAnalytics(
    @Param('address') address: string,
    @Query(new ValidationPipe({ transform: true })) query: AnalyticsQueryDto,
  ): Promise<UserAnalyticsResponse> {
    return this.analyticsService.getUserAnalytics(address, query.range ?? DateRangeFilter.SEVEN_DAYS);
  }

  @Get(':address/stakes')
  @ApiOperation({ summary: 'Get paginated stake history for a user' })
  @ApiParam({ name: 'address', description: 'Stellar wallet address' })
  @ApiQuery({ name: 'status', enum: ['ACTIVE', 'WON', 'LOST', 'REFUNDED'], required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiResponse({ status: HttpStatus.OK, description: 'User stakes retrieved' })
  getUserStakes(
    @Param('address') address: string,
    @Query(new ValidationPipe({ transform: true })) query: StakesQueryDto,
  ) {
    return this.analyticsService.getUserStakes(address, query.status, query.page, query.limit);
  }
}
