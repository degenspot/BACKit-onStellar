import { ApiProperty } from '@nestjs/swagger';

export class TokenTransferDto {
  @ApiProperty({ description: 'Sender address' })
  from: string;

  @ApiProperty({ description: 'Recipient address' })
  to: string;

  @ApiProperty({ description: 'Amount transferred' })
  amount: string;

  @ApiProperty({ description: 'Token symbol' })
  token: string;
}

export class PoolRatiosDto {
  @ApiProperty({ description: 'UP pool ratio in basis points' })
  up_bps: number;

  @ApiProperty({ description: 'DOWN pool ratio in basis points' })
  down_bps: number;
}

export class SimulationResultDto {
  @ApiProperty({ description: 'Action type' })
  action: string;

  @ApiProperty({ description: 'Contract address invoked' })
  contract_called: string;

  @ApiProperty({ description: 'Function invoked' })
  function_called: string;

  @ApiProperty({
    type: [TokenTransferDto],
    description: 'Parsed token transfers',
  })
  token_transfers: TokenTransferDto[];

  @ApiProperty({
    type: PoolRatiosDto,
    description: 'New pool ratios after operation',
  })
  new_pool_ratios: PoolRatiosDto;

  @ApiProperty({ description: 'Estimated payout if user wins' })
  estimated_payout_if_win: string;

  @ApiProperty({ description: 'Estimated gas fee in XLM' })
  estimated_gas_xlm: string;

  @ApiProperty({ description: 'Estimated gas fee in USD' })
  estimated_gas_usd: string;

  @ApiProperty({ description: 'Whether the transaction simulation succeeded' })
  will_succeed: boolean;

  @ApiProperty({
    description: 'Human readable error message if simulation failed',
    nullable: true,
  })
  error_message: string | null;
}
