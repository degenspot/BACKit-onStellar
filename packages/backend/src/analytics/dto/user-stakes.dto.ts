import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UserStakesQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Results per page',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}

export class CallSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  description: string;

  @ApiProperty({ enum: ['YES', 'NO', 'PENDING'] })
  outcome: 'YES' | 'NO' | 'PENDING';

  @ApiPropertyOptional({ description: 'When the call was resolved, if applicable', type: String })
  resolvedAt?: Date | null;

  @ApiPropertyOptional({ description: 'When the call expires, if applicable', type: String })
  expiresAt?: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ description: 'Address of the on-chain contract', nullable: true })
  contractAddress?: string | null;

  @ApiProperty({ description: 'Total YES stake on this call' })
  totalYesStake: number;

  @ApiProperty({ description: 'Total NO stake on this call' })
  totalNoStake: number;
}

export class StakeLedgerItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  callId: string;

  @ApiProperty()
  userAddress: string;

  @ApiProperty({ description: 'Stake amount in XLM' })
  amount: number;

  @ApiProperty({ enum: ['YES', 'NO'] })
  position: 'YES' | 'NO';

  @ApiPropertyOptional({ description: 'Realized profit or loss in XLM', nullable: true })
  profitLoss?: number | null;

  @ApiPropertyOptional({ description: 'Underlying transaction hash', nullable: true })
  transactionHash?: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({
    description: 'Derived resolution status for this stake based on the underlying call',
    enum: ['PENDING', 'RESOLVED'],
  })
  resolutionStatus: 'PENDING' | 'RESOLVED';

  @ApiPropertyOptional({ type: CallSummaryDto })
  call?: CallSummaryDto;
}

export class UserStakesResponseDto {
  @ApiProperty({ type: [StakeLedgerItemDto] })
  data: StakeLedgerItemDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}

