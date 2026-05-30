import { ApiProperty } from '@nestjs/swagger';

export class TotalValueLockedResponseDto {
  @ApiProperty({
    description: 'Wallet address the TVL was calculated for',
    example: 'GBXXX...',
  })
  userAddress: string;

  @ApiProperty({
    description: 'Sum of all Pending stake amounts for this user, in XLM',
    example: 1250.75,
  })
  totalValueLocked: number;

  @ApiProperty({
    description: 'Number of individual Pending stakes included in the sum',
    example: 8,
  })
  pendingStakesCount: number;
}
