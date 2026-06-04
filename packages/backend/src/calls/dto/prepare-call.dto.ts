import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PrepareCallDto {
  @ApiProperty({ maxLength: 200, example: 'XLM will hit $0.50 by EOY' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  thesis: string;

  @ApiProperty({ example: 'Price above $0.50 at resolution time' })
  @IsString()
  @IsNotEmpty()
  condition: string;

  @ApiProperty({ example: 'XLM/USDC' })
  @IsString()
  @IsNotEmpty()
  tokenPair: string;
}
