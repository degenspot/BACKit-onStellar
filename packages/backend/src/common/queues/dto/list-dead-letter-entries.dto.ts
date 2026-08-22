import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DeadLetterClassification } from '../dead-letter-classification.enum';
import { ReplayStatus } from '../dead-letter.service';
import {
  QUEUE_IPFS_PINNING,
  QUEUE_NOTIFICATIONS,
  QUEUE_ORACLE_SIGNING,
} from '../queues.constants';

const REPLAYABLE_SOURCE_QUEUES = [
  QUEUE_ORACLE_SIGNING,
  QUEUE_IPFS_PINNING,
  QUEUE_NOTIFICATIONS,
] as const;

export class ListDeadLetterEntriesDto {
  @ApiPropertyOptional({
    description: 'Opaque pagination cursor from a previous response',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: REPLAYABLE_SOURCE_QUEUES })
  @IsOptional()
  @IsEnum(REPLAYABLE_SOURCE_QUEUES)
  sourceQueue?: (typeof REPLAYABLE_SOURCE_QUEUES)[number];

  @ApiPropertyOptional({ enum: DeadLetterClassification })
  @IsOptional()
  @IsEnum(DeadLetterClassification)
  classification?: DeadLetterClassification;

  @ApiPropertyOptional({ enum: ReplayStatus })
  @IsOptional()
  @IsEnum(ReplayStatus)
  replayStatus?: ReplayStatus;

  @ApiPropertyOptional({
    description: 'ISO date - only entries moved to the DLQ on/after this date',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'ISO date - only entries moved to the DLQ on/before this date',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
