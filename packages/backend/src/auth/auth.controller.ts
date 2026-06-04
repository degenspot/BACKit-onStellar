import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { IsStellarAddress } from '../common/validators/stellar-address.validator';
import { AuthService } from './auth.service';

class ChallengeDto {
  @IsStellarAddress()
  address: string;
}

class VerifyDto {
  @IsStellarAddress()
  address: string;

  @IsString()
  @IsNotEmpty()
  signature: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('challenge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a nonce challenge for the given Stellar address',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns nonce and message to sign',
    schema: {
      example: { nonce: 'backit-auth-...', message: 'Sign this message...' },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid Stellar address' })
  challenge(@Body() dto: ChallengeDto) {
    return this.authService.generateChallenge(dto.address);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify ed25519 signature and return JWT' })
  @ApiResponse({
    status: 200,
    description: 'Returns JWT access token',
    schema: { example: { accessToken: 'eyJ...' } },
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired signature' })
  verify(@Body() dto: VerifyDto) {
    return this.authService.verifySignature(dto.address, dto.signature);
  }
}
