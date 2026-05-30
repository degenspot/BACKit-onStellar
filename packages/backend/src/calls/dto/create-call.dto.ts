import {
  IsString,
  IsNumber,
  IsDateString,
  IsBoolean,
  IsOptional,
  IsNotEmpty,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCallDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  thesis: string;

  @IsString()
  @IsNotEmpty()
  tokenAddress: string;

  @IsString()
  @IsNotEmpty()
  pairId: string;

  @IsString()
  @IsNotEmpty()
  stakeToken: string;

  @IsNumber()
  @Min(0)
  stakeAmount: number;

  @IsDateString()
  endTs: string;

  @IsBoolean()
  @IsOptional()
  settled?: boolean;

  @IsOptional()
  @IsString()
  ipfsCid?: string;

  @IsOptional()
  @IsString()
  conditionJson?: string;
}
