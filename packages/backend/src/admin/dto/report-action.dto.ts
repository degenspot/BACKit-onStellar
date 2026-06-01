import { IsBoolean, IsOptional } from 'class-validator';

export class ReportActionDto {
  @IsOptional()
  @IsBoolean()
  banCreator?: boolean;
}
