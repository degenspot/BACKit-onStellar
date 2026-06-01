import { IsEnum, IsOptional } from 'class-validator';

export enum ReportReason {
  SPAM = 'SPAM',
  MISLEADING = 'MISLEADING',
  OFFENSIVE = 'OFFENSIVE',
  MARKET_MANIPULATION = 'MARKET_MANIPULATION',
  OTHER = 'OTHER',
}

export class ReportCallDto {
  @IsOptional()
  @IsEnum(ReportReason)
  reason?: ReportReason;
}
