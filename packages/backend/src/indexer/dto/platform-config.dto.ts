import { ApiProperty } from '@nestjs/swagger';

export class PlatformConfigDto {
  @ApiProperty({
    description: 'Platform fee percentage',
    example: 5,
  })
  feePercent: number;

  @ApiProperty({
    description: 'Transaction hash of the last update',
    example: 'abc123...',
    nullable: true,
  })
  lastUpdatedByTxHash: string | null;

  @ApiProperty({
    description: 'Ledger number of the last update',
    example: 12345,
    nullable: true,
  })
  lastUpdatedAtLedger: number | null;

  @ApiProperty({
    description: 'Timestamp of the last update',
    example: '2024-01-01T00:00:00.000Z',
  })
  updatedAt: Date;
}
