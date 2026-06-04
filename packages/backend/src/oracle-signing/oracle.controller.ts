import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { OracleSigningService } from './oracle-signing.service';
import { SignPriceDto } from './sign-price.dto';
import { SignedPriceData, OraclePublicKeyResponse } from './oracle.interfaces';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_ORACLE_SIGNING } from '../common/queues/queues.constants';

@ApiTags('Oracle')
@Controller('oracle')
export class OracleController {
  constructor(
    private readonly signingService: OracleSigningService,
    @InjectQueue(QUEUE_ORACLE_SIGNING) private readonly oracleQueue: Queue,
  ) {}

  @Get('public-key')
  @ApiOperation({
    summary: 'Get oracle public key',
    description:
      'Returns the 32-byte Ed25519 public key (hex) used by the Soroban contract for ed25519_verify.',
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

  @Post('sign/async')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Enqueue a price signing job',
    description:
      'Runs signing in a BullMQ background worker. Use GET /oracle/sign/jobs/:jobId to poll the result.',
  })
  async enqueueSignPrice(
    @Body() dto: SignPriceDto,
  ): Promise<{ jobId: string }> {
    const job = await this.oracleQueue.add('sign-price', {
      payload: {
        asset: dto.asset,
        price: dto.price,
        timestamp: dto.timestamp,
      },
    });
    return { jobId: String(job.id) };
  }

  @Get('sign/jobs/:jobId')
  @ApiOperation({ summary: 'Get oracle signing job status/result' })
  async getSigningJob(@Param('jobId') jobId: string) {
    const job = await this.oracleQueue.getJob(jobId);
    if (!job) return { status: 'not_found' as const };

    const status = await job.getState();
    return {
      status,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
    };
  }
}
