import { IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum DateRangeFilter {
  SEVEN_DAYS = '7d',
  THIRTY_DAYS = '30d',
  ALL = 'all',
}

export class AnalyticsQueryDto {
  @ApiProperty({
    enum: DateRangeFilter,
    default: DateRangeFilter.SEVEN_DAYS,
    description: 'Date range filter for analytics data',
    required: false,
  })
  @IsEnum(DateRangeFilter)
  @IsOptional()
  range?: DateRangeFilter = DateRangeFilter.SEVEN_DAYS;
}
