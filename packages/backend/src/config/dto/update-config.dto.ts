import {
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  feePercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minStake?: number;

  @IsOptional()
  @IsInt()
  @Min(60)
  maxDuration?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedTokens?: string[];

  @IsOptional()
  @IsObject()
  contractAddresses?: Record<string, string>;
}
