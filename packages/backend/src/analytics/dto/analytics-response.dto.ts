import { ApiProperty } from '@nestjs/swagger';

export class ChartDataPoint {
  @ApiProperty({ description: 'Date in ISO format' })
  date: string;

  @ApiProperty({ description: 'Numerical value for the data point' })
  value: number;
}

export class ProfitDataPoint extends ChartDataPoint {
  @ApiProperty({ description: 'Cumulative profit in XLM' })
  declare value: number;
}

export class AccuracyDataPoint extends ChartDataPoint {
  @ApiProperty({ description: 'Accuracy percentage (0-100)' })
  declare value: number;
}

export class WinLossCount {
  @ApiProperty({ description: 'Number of wins' })
  wins: number;

  @ApiProperty({ description: 'Number of losses' })
  losses: number;

  @ApiProperty({ description: 'Number of pending outcomes' })
  pending: number;

  @ApiProperty({ description: 'Total calls' })
  total: number;
}

export class UserAnalyticsResponse {
  @ApiProperty({
    type: [ProfitDataPoint],
    description: 'Cumulative profit over time',
  })
  cumulativeProfitPerDay: ProfitDataPoint[];

  @ApiProperty({
    type: [ProfitDataPoint],
    description: 'Cumulative profit per week',
  })
  cumulativeProfitPerWeek: ProfitDataPoint[];

  @ApiProperty({
    type: [AccuracyDataPoint],
    description: 'Accuracy trend over time',
  })
  accuracyTrend: AccuracyDataPoint[];

  @ApiProperty({ type: WinLossCount, description: 'Win/loss statistics' })
  winLossCount: WinLossCount;

  @ApiProperty({ description: 'Total profit/loss in XLM' })
  totalProfitLoss: number;

  @ApiProperty({ description: 'Overall accuracy percentage' })
  overallAccuracy: number;

  @ApiProperty({ description: 'Date range used for the query' })
  dateRange: string;
}
