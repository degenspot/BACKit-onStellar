import { IsString, IsNotEmpty, IsNumber, IsPositive, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignPriceDto {
  @ApiProperty({ example: 'BTC_USD', description: 'Asset pair identifier' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{2,10}(_[A-Z]{2,10})?$/, {
    message: 'Asset must be uppercase letters, optionally with underscore pair e.g. BTC_USD',
  })
  asset: string;

  @ApiProperty({ example: '65000.50', description: 'Price as decimal string' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d+)?$/, { message: 'Price must be a positive decimal string' })
  price: string;

  @ApiProperty({ example: 1700000000, description: 'Unix timestamp in seconds' })
  @IsNumber()
  @IsPositive()
  timestamp: number;
}
