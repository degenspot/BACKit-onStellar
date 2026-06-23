import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpStatus,
  HttpCode,
  Logger,
  NotFoundException,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { OracleService } from './oracle.service';
import { OracleCall } from './entities/oracle-call.entity';
import { OracleOutcome } from './entities/oracle-outcome.entity';
import { IpfsService } from '../storage/ipfs.service';

export class CreateOracleCallDto {
  pairAddress: string;
  baseToken: string;
  quoteToken: string;
  strikePrice: number;
  callTime: Date;
}

@ApiTags('oracle')
@Controller('api/oracle')
export class OracleController {
  private readonly logger = new Logger(OracleController.name);

  constructor(
    private readonly oracleService: OracleService,
    private readonly ipfsService: IpfsService,
  ) {}

  @Post('calls')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new oracle call' })
  async createCall(@Body() dto: CreateOracleCallDto): Promise<OracleCall> {
    return this.oracleService.createOracleCall(
      dto.pairAddress,
      dto.baseToken,
      dto.quoteToken,
      dto.strikePrice,
      new Date(dto.callTime),
    );
  }

  @Get('calls/pending')
  @ApiOperation({ summary: 'Get all pending oracle calls' })
  async getPendingCalls(): Promise<OracleCall[]> {
    return this.oracleService.getPendingCalls();
  }

  @Get('calls/:callId/outcomes')
  @ApiOperation({ summary: 'Get outcomes for a specific oracle call' })
  @ApiParam({ name: 'callId', description: 'Oracle call ID' })
  async getOutcomesForCall(
    @Param('callId', ParseIntPipe) callId: number,
  ): Promise<OracleOutcome[]> {
    const outcomes = await this.oracleService.getOutcomesForCall(callId);
    if (!outcomes || outcomes.length === 0) {
      throw new NotFoundException(`No outcomes found for call ${callId}`);
    }
    return outcomes;
  }

  @Get('calls/:callId/evidence')
  @ApiOperation({
    summary: 'Get IPFS evidence CID and gateway link for a resolved call',
  })
  @ApiParam({ name: 'callId', description: 'Oracle call ID' })
  @ApiResponse({
    status: 200,
    description: 'Evidence CID and IPFS gateway URL',
  })
  @ApiResponse({ status: 404, description: 'No evidence found' })
  async getEvidence(@Param('callId', ParseIntPipe) callId: number) {
    const outcomes = await this.oracleService.getOutcomesForCall(callId);
    const withEvidence = outcomes?.filter((o) => o.evidence_cid);
    if (!withEvidence || withEvidence.length === 0) {
      throw new NotFoundException(`No IPFS evidence found for call ${callId}`);
    }
    const latest = withEvidence[withEvidence.length - 1];
    return {
      callId,
      evidenceCid: latest.evidence_cid,
      ipfsUrl: this.ipfsService.getGatewayUrl(latest.evidence_cid),
      resolvedAt: latest.createdAt,
    };
  }

  @Get('calls/:callId/price-sources')
  @ApiOperation({ summary: 'Get all price sources queried and their values' })
  @ApiParam({ name: 'callId', description: 'Oracle call ID' })
  async getPriceSources(@Param('callId', ParseIntPipe) callId: number) {
    return this.oracleService.getPriceSources(callId);
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Oracle module health check' })
  getHealth() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      module: 'oracle-worker',
    };
  }
}
