import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WhitelistTokenDto {
  @ApiProperty({
    description: 'Stellar asset code (e.g. USDC, XLM)',
    maxLength: 12,
    example: 'USDC',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  assetCode: string;

  @ApiProperty({
    description:
      'Stellar public key of the issuing account (null for native XLM)',
    maxLength: 56,
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    nullable: true,
  })
  @IsString()
  @IsOptional()
  assetIssuer?: string | null;

  @ApiPropertyOptional({
    description: 'Number of decimal places (defaults to 7 if not provided)',
    default: 7,
    minimum: 0,
    maximum: 18,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(18)
  decimals?: number;

  @ApiPropertyOptional({
    description: 'URL of the token logo',
    maxLength: 500,
    example: 'https://stellar.expert/img/assets/USDC.svg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;
}
