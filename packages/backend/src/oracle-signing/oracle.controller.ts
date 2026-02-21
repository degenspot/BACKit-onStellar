import { Body, Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { OracleSigningService } from './services/oracle-signing.service';
import { SignPriceDto } from './dto/sign-price.dto';
import { SignedPriceData, OraclePublicKeyResponse } from './interfaces/oracle.interfaces';

@ApiTags('Oracle')
@Controller('oracle')
export class OracleController {
  constructor(private readonly signingService: OracleSigningService) {}

  @Get('public-key')
  @ApiOperation({
    summary: 'Get oracle public key',
    description: 'Returns the 32-byte Ed25519 public key (hex) used by the Soroban contract for ed25519_verify.',
  })
  @ApiResponse({ status: 200, description: 'Public key in hex format' })
  getPublicKey(): OraclePublicKeyResponse {
    return this.signingService.getPublicKey();
  }

  @Post('sign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign a price data payload',
    description:
      'Signs asset/price/timestamp with the oracle Ed25519 key. The returned signature is compatible with Soroban ed25519_verify.',
  })
  @ApiResponse({ status: 200, description: 'Signed price data' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  signPrice(@Body() dto: SignPriceDto): SignedPriceData {
    return this.signingService.sign({
      asset: dto.asset,
      price: dto.price,
      timestamp: dto.timestamp,
    });
  }
}
