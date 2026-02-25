import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { SorobanRpc, Contract, xdr } from '@stellar/stellar-sdk';
import { OracleCall, OracleCallStatus } from './entities/oracle-call.entity';
import { OracleOutcome } from './entities/oracle-outcome.entity';
import { retryWithBackoff, Retryable } from '../utils/retry';
import { REPORT_THRESHOLD } from '../calls/constants/moderation.constants';

@Injectable()
export class OracleService {
  private readonly logger = new Logger(OracleService.name);

  constructor(
    private readonly rpcServer: SorobanRpc.Server,
    @InjectRepository(OracleCall)
    private readonly oracleCallRepository: Repository<OracleCall>,
    @InjectRepository(OracleOutcome)
    private readonly oracleOutcomeRepository: Repository<OracleOutcome>,
  ) {}

  // ─── Core CRUD ────────────────────────────────────────────────────────────

  async createOracleCall(
    pairAddress: string,
    baseToken: string,
    quoteToken: string,
    strikePrice: number,
    callTime: Date,
  ): Promise<OracleCall> {
    const call = this.oracleCallRepository.create({
      pairAddress,
      baseToken,
      quoteToken,
      strikePrice,
      callTime,
    });
    return this.oracleCallRepository.save(call);
  }

  async getPendingCalls(): Promise<OracleCall[]> {
    return this.oracleCallRepository.find({
      where: { processedAt: IsNull(), failedAt: IsNull() },
    });
  }

  async getOutcomesForCall(callId: number): Promise<OracleOutcome[]> {
    return this.oracleOutcomeRepository.find({
      where: { call: { id: callId } },
      relations: ['call'],
    });
  }

  // ─── Price Fetching ───────────────────────────────────────────────────────

  @Retryable(4, 1000)
  async fetchOraclePrice(contractId: string, assetSymbol: string): Promise<bigint> {
    const contract = new Contract(contractId);

    // Extract operation first so the cast stays on one clean expression
    const operation = contract.call('lastprice', xdr.ScVal.scvSymbol(assetSymbol));
    const tx = await this.rpcServer.simulateTransaction(
      operation as unknown as Parameters<SorobanRpc.Server['simulateTransaction']>[0],
    );

    if (SorobanRpc.Api.isSimulationError(tx)) {
      throw new Error(`Oracle simulation error for ${assetSymbol}: ${tx.error}`);
    }

    const result = (tx as SorobanRpc.Api.SimulateTransactionSuccessResponse).result;
    if (!result) {
      throw new Error(`No result returned for oracle price of ${assetSymbol}`);
    }

    return result.retval.i128().lo().toBigInt();
  }

  async fetchAllPrices(
    contractId: string,
    symbols: string[],
  ): Promise<Record<string, bigint>> {
    const results: Record<string, bigint> = {};

    await Promise.all(
      symbols.map(async (symbol) => {
        results[symbol] = await retryWithBackoff(
          () => this.fetchOraclePrice(contractId, symbol),
          4,
          1000,
          `fetchOraclePrice(${symbol})`,
        );
      }),
    );

    return results;
  }

  async simulateContractRead(
    tx: Parameters<SorobanRpc.Server['simulateTransaction']>[0],
    label = 'simulateContractRead',
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    return retryWithBackoff(
      () => this.rpcServer.simulateTransaction(tx),
      4,
      1000,
      label,
    );
  }

  // ─── Circuit Breaker Resolution ───────────────────────────────────────────

  /**
   * Called by the oracle cron for every pending market.
   * Throws before touching Soroban if the market is PAUSED.
   */
  async resolveMarket(callId: number, observedPrice: string): Promise<void> {
    const call = await this.findCallOrThrow(callId);

    // ── CIRCUIT BREAKER ──────────────────────────────────────────────────
    if (call.status === OracleCallStatus.PAUSED) {
      this.logger.warn(
        `Oracle BLOCKED for call ${callId} — PAUSED (reports: ${call.reportCount}/${REPORT_THRESHOLD})`,
      );
      // Mark as failed so the cron stops retrying until admin intervenes
      call.failedAt = new Date();
      await this.oracleCallRepository.save(call);

      throw new BadRequestException(
        `Market ${callId} is paused due to community reports. Admin review required.`,
      );
    }

    // Guard: already resolved — idempotent, no error
    const terminal = [OracleCallStatus.RESOLVED_YES, OracleCallStatus.RESOLVED_NO];
    if (terminal.includes(call.status)) {
      this.logger.log(`Call ${callId} already resolved — skipping.`);
      return;
    }

    if (![OracleCallStatus.OPEN, OracleCallStatus.SETTLING].includes(call.status)) {
      throw new BadRequestException(`Cannot resolve call in status ${call.status}`);
    }

    const outcome = this.evaluateOutcome(call, observedPrice);

    // TODO: swap stub for real Soroban signing + submission
    // const builtTx = await this.signingService.buildResolutionTx(callId, outcome);
    // const signed  = await this.signingService.sign(builtTx);
    // await this.rpcServer.sendTransaction(signed);

    call.status      = outcome;
    call.finalPrice  = observedPrice;
    call.resolvedAt  = new Date();
    call.processedAt = new Date();
    await this.oracleCallRepository.save(call);

    this.logger.log(`Call ${callId} resolved → ${outcome} @ ${observedPrice}`);
  }

  // ─── Reporting — increments count and auto-pauses ─────────────────────────

  async recordReport(callId: number): Promise<OracleCall> {
    const call = await this.findCallOrThrow(callId);

    call.reportCount += 1;
    call.isHidden = call.reportCount >= REPORT_THRESHOLD;

    if (
      call.reportCount >= REPORT_THRESHOLD &&
      call.status === OracleCallStatus.OPEN
    ) {
      call.status = OracleCallStatus.PAUSED;
      this.logger.warn(
        `Call ${callId} AUTO-PAUSED after ${call.reportCount} reports.`,
      );
    }

    return this.oracleCallRepository.save(call);
  }

  // ─── Admin: Unpause ───────────────────────────────────────────────────────

  async unpauseCall(callId: number): Promise<OracleCall> {
    const call = await this.findCallOrThrow(callId);

    if (call.status !== OracleCallStatus.PAUSED) {
      throw new BadRequestException(
        `Call is not paused (current status: ${call.status})`,
      );
    }

    call.status   = OracleCallStatus.OPEN;
    call.failedAt = null;

    this.logger.log(`Call ${callId} manually UNPAUSED by admin.`);
    return this.oracleCallRepository.save(call);
  }

  // ─── Admin: Force Resolve ─────────────────────────────────────────────────

  async adminResolveCall(
    callId: number,
    resolution: OracleCallStatus.RESOLVED_YES | OracleCallStatus.RESOLVED_NO,
    finalPrice?: string,
  ): Promise<OracleCall> {
    const call = await this.findCallOrThrow(callId);

    const resolvable = [
      OracleCallStatus.OPEN,
      OracleCallStatus.PAUSED,
      OracleCallStatus.SETTLING,
    ];

    if (!resolvable.includes(call.status)) {
      throw new BadRequestException(
        `Cannot force-resolve a call with status ${call.status}`,
      );
    }

    call.status      = resolution;
    call.resolvedAt  = new Date();
    call.processedAt = new Date();
    call.failedAt    = null;
    if (finalPrice !== undefined) call.finalPrice = finalPrice;

    this.logger.log(`Call ${callId} FORCE-RESOLVED by admin → ${resolution}`);
    return this.oracleCallRepository.save(call);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async findCallOrThrow(callId: number): Promise<OracleCall> {
    const call = await this.oracleCallRepository.findOne({ where: { id: callId } });
    if (!call) throw new NotFoundException(`OracleCall ${callId} not found`);
    return call;
  }

  private evaluateOutcome(
    call: OracleCall,
    observedPrice: string,
  ): OracleCallStatus.RESOLVED_YES | OracleCallStatus.RESOLVED_NO {
    const observed = parseFloat(observedPrice);
    return observed >= call.strikePrice
      ? OracleCallStatus.RESOLVED_YES
      : OracleCallStatus.RESOLVED_NO;
  }
}