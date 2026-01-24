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
} from '@nestjs/common';
import { OracleService } from './oracle.service';
import { OracleCall } from './entities/oracle-call.entity';
import { OracleOutcome } from './entities/oracle-outcome.entity';

export class CreateOracleCallDto {
  pairAddress: string;
  baseToken: string;
  quoteToken: string;
  strikePrice: number;
  callTime: Date;
}

@Controller('api/oracle')
export class OracleController {
  private readonly logger = new Logger(OracleController.name);

  constructor(private readonly oracleService: OracleService) {}

  /**
   * Create a new oracle call
   */
  @Post('calls')
  @HttpCode(HttpStatus.CREATED)
  async createCall(dto: CreateOracleCallDto): Promise<OracleCall> {
    this.logger.log(
      `Creating oracle call for pair ${dto.pairAddress} with strike ${dto.strikePrice}`,
    );

    return await this.oracleService.createOracleCall(
      dto.pairAddress,
      dto.baseToken,
      dto.quoteToken,
      dto.strikePrice,
      new Date(dto.callTime),
    );
  }

  /**
   * Get all pending oracle calls
   */
  @Get('calls/pending')
  async getPendingCalls(): Promise<OracleCall[]> {
    return await this.oracleService.getPendingCalls();
  }

  /**
   * Get outcomes for a specific call
   */
  @Get('calls/:callId/outcomes')
  async getOutcomesForCall(callId: number): Promise<OracleOutcome[]> {
    const outcomes = await this.oracleService.getOutcomesForCall(callId);

    if (!outcomes || outcomes.length === 0) {
      throw new NotFoundException(
        `No outcomes found for call ${callId}`,
      );
    }

    return outcomes;
  }

  /**
   * Health check endpoint
   */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  getHealth() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      module: 'oracle-worker',
    };
  }
}
