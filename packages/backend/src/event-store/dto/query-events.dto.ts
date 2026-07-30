import {
  IsOptional,
  IsEnum,
  IsString,
  IsInt,
  Min,
  Max,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AggregateType } from '../entities/event-store-entry.entity';

export class QueryEventsDto {
  @ApiPropertyOptional({
    enum: AggregateType,
    description: 'Filter by aggregate type',
  })
  @IsOptional()
  @IsEnum(AggregateType)
  aggregate_type?: AggregateType;

  @ApiPropertyOptional({ description: 'Filter by aggregate ID' })
  @IsOptional()
  @IsString()
  aggregate_id?: string;

  @ApiPropertyOptional({
    description: 'Start of date range (ISO 8601)',
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'End of date range (ISO 8601)',
    example: '2024-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Results per page',
    default: 50,
    minimum: 1,
    maximum: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;
}
