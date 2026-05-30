import { IsOptional, IsDateString } from 'class-validator';

export class TreasurySummaryQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

