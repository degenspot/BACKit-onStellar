import {
  IsEnum,
  IsString,
  IsOptional,
  Matches,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IpRuleType } from '../entities/ip-rule.entity';
import { BlockReason } from '../entities/blocked-request.entity';

export class CreateIpRuleDto {
  @ApiProperty({
    description: 'IPv4/IPv6 address or CIDR range',
    examples: ['192.168.1.42', '10.0.0.0/8', '2001:db8::/32'],
  })
  @IsString()
  @MaxLength(64)
  // Allows plain IPs and CIDR notation
  @Matches(/^[\d.:/a-fA-F]+$/, {
    message: 'cidr must be a valid IP address or CIDR range',
  })
  cidr: string;

  @ApiProperty({ enum: IpRuleType, description: 'WHITELIST or BLACKLIST' })
  @IsEnum(IpRuleType)
  type: IpRuleType;

  @ApiPropertyOptional({ description: 'Human-readable reason for this rule' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string;
}

export class QueryBlockedRequestsDto {
  @ApiPropertyOptional({ description: 'Filter by client IP address' })
  @IsOptional()
  @IsString()
  ip?: string;

  @ApiPropertyOptional({ enum: BlockReason, description: 'Filter by block reason' })
  @IsOptional()
  @IsEnum(BlockReason)
  reason?: BlockReason;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}