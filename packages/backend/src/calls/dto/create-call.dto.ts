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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsStellarAddress } from '../../common/validators/stellar-address.validator';

export class CreateCallDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  thesis: string;

  @ApiProperty({ description: 'Token contract address' })
  @IsString()
  @IsNotEmpty()
  tokenAddress: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  pairId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  stakeToken: string;

  @ApiProperty({ minimum: 0 })
  @IsNumber()
  @Min(0)
  stakeAmount: number;

  @ApiProperty()
  @IsDateString()
  endTs: string;

  @ApiProperty({ description: 'Creator Stellar address' })
  @IsStellarAddress()
  creatorAddress: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  settled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ipfsCid?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  conditionJson?: string;
}

export class PrepareCallDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  thesis: string;

  @ApiProperty({ description: 'Human-readable resolution condition' })
  @IsString()
  @IsNotEmpty()
  condition: string;

  @ApiProperty({ example: 'XLM/USDC' })
  @IsString()
  @IsNotEmpty()
  tokenPair: string;
}
