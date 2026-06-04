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
import { OracleHealthService } from './oracle-health.service';
import { OracleOperationType } from './entities/oracle-health-log.entity';
import { SigningService } from './signing.service';
import { IpfsService } from '../storage/ipfs.service';

/**
 * High-level lifecycle status for a market/call, used by analytics and UI.
 *
 * - PENDING: Created but not yet active on the oracle.
 * - ACTIVE:  Live and eligible for resolution (OPEN or SETTLING).
 * - PAUSED:  Temporarily disabled due to moderation/circuit breaker.
 * - RESOLVED: Terminal state (RESOLVED_YES or RESOLVED_NO).
 */
export enum MarketStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  RESOLVED = 'RESOLVED',
}

@Injectable()
export class OracleService {
  private readonly logger = new Logger(OracleService.name);

  constructor(
    private readonly rpcServer: SorobanRpc.Server,
    @InjectRepository(OracleCall)
    private readonly oracleCallRepository: Repository<OracleCall>,
    @InjectRepository(OracleOutcome)
    private readonly oracleOutcomeRepository: Repository<OracleOutcome>,
    private readonly oracleHealthService: OracleHealthService,
    private readonly signingService: SigningService,
    private readonly ipfsService: IpfsService,
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

  /**
   * Derive a coarse-grained lifecycle status for a given oracle call.
   * This centralizes how low-level OracleCallStatus values are exposed
   * to other modules (analytics, API, UI).
   */
  async getMarketStatus(callId: number): Promise<MarketStatus> {
    const call = await this.findCallOrThrow(callId);

    switch (call.status) {
      case OracleCallStatus.DRAFT:
        return MarketStatus.PENDING;
      case OracleCallStatus.OPEN:
      case OracleCallStatus.SETTLING:
        return MarketStatus.ACTIVE;
      case OracleCallStatus.PAUSED:
        return MarketStatus.PAUSED;
      case OracleCallStatus.RESOLVED_YES:
      case OracleCallStatus.RESOLVED_NO:
        return MarketStatus.RESOLVED;
      default:
        // Fallback for any future/unknown status values
        return MarketStatus.PENDING;
    }
  }

  // ─── Price Fetching ───────────────────────────────────────────────────────

  @Retryable(4, 1000)
  async fetchOraclePrice(
    contractId: string,
    assetSymbol: string,
  ): Promise<bigint> {
    const submissionTime = new Date();

    try {
      const contract = new Contract(contractId);

      // Extract operation first so the cast stays on one clean expression
      const operation = contract.call(
        'lastprice',
        xdr.ScVal.scvSymbol(assetSymbol),
      );
      const tx = await this.rpcServer.simulateTransaction(
        operation as unknown as Parameters<
          SorobanRpc.Server['simulateTransaction']
        >[0],
      );

      if (SorobanRpc.Api.isSimulationError(tx)) {
        throw new Error(
          `Oracle simulation error for ${assetSymbol}: ${tx.error}`,
        );
      }

      const result = tx.result;
      if (!result) {
        throw new Error(
          `No result returned for oracle price of ${assetSymbol}`,
        );
      }

      const price = result.retval.i128().lo().toBigInt();
      await this.oracleHealthService.recordOperation({
        oracleKey: contractId,
        callId: assetSymbol,
        operation: OracleOperationType.FETCH,
        submissionTime,
        priceFetched: Number(price),
        success: true,
      });

      return price;
    } catch (error) {
      await this.oracleHealthService.recordOperation({
        oracleKey: contractId,
        callId: assetSymbol,
        operation: OracleOperationType.FETCH,
        submissionTime,
        priceFetched: null,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    const submissionTime = new Date();
    const call = await this.findCallOrThrow(callId);

    // ── CIRCUIT BREAKER ──────────────────────────────────────────────────
    if (call.status === OracleCallStatus.PAUSED) {
      this.logger.warn(
        `Oracle BLOCKED for call ${callId} — PAUSED (reports: ${call.reportCount}/${REPORT_THRESHOLD})`,
      );
      // Mark as failed so the cron stops retrying until admin intervenes
      call.failedAt = new Date();
      await this.oracleCallRepository.save(call);
      await this.oracleHealthService.recordOperation({
        oracleKey: call.pairAddress,
        callId,
        operation: OracleOperationType.SUBMIT,
        submissionTime,
        priceFetched: Number(observedPrice),
        expectedPrice: Number(call.strikePrice),
        success: false,
        errorMessage: `Market ${callId} is paused due to community reports.`,
      });

      throw new BadRequestException(
        `Market ${callId} is paused due to community reports. Admin review required.`,
      );
    }

    // Guard: already resolved — idempotent, no error
    const terminal = [
      OracleCallStatus.RESOLVED_YES,
      OracleCallStatus.RESOLVED_NO,
    ];
    if (terminal.includes(call.status)) {
      this.logger.log(`Call ${callId} already resolved — skipping.`);
      return;
    }

    if (
      ![OracleCallStatus.OPEN, OracleCallStatus.SETTLING].includes(call.status)
    ) {
      await this.oracleHealthService.recordOperation({
        oracleKey: call.pairAddress,
        callId,
        operation: OracleOperationType.SUBMIT,
        submissionTime,
        priceFetched: Number(observedPrice),
        expectedPrice: Number(call.strikePrice),
        success: false,
        errorMessage: `Cannot resolve call in status ${call.status}`,
      });
      throw new BadRequestException(
        `Cannot resolve call in status ${call.status}`,
      );
    }

    const outcome = this.evaluateOutcome(call, observedPrice);

    const signature = this.signingService.signOutcome({
      callId,
      price: Number(observedPrice),
      timestamp: Math.floor(Date.now() / 1000),
      outcome: outcome === OracleCallStatus.RESOLVED_YES ? 'YES' : 'NO',
      pairAddress: call.pairAddress,
    });

    // Pin resolution evidence to IPFS (non-blocking — never stops resolution)
    let evidenceCid: string | undefined;
    try {
      evidenceCid = await this.ipfsService.pinEvidencePayload({
        callId,
        source: 'oracle',
        apiUrl: `soroban-rpc:${call.pairAddress}`,
        rawResponse: { pairAddress: call.pairAddress, observedPrice },
        fetchedAt: new Date().toISOString(),
        priceUsed: Number(observedPrice),
      });
    } catch {
      this.logger.warn(`IPFS evidence pinning failed for call ${callId}, continuing`);
    }

    await this.oracleOutcomeRepository.save(
      this.oracleOutcomeRepository.create({
        call,
        price: Number(observedPrice),
        outcome: outcome === OracleCallStatus.RESOLVED_YES ? 'YES' : 'NO',
        signature,
        transactionHash: undefined,
        ...(evidenceCid ? { evidence_cid: evidenceCid } : {}),
      } as any),
    );

    call.status = outcome;
    call.finalPrice = observedPrice;
    call.resolvedAt = new Date();
    call.processedAt = new Date();
    await this.oracleCallRepository.save(call);
    await this.oracleHealthService.recordOperation({
      oracleKey: call.pairAddress,
      callId,
      operation: OracleOperationType.SUBMIT,
      submissionTime,
      priceFetched: Number(observedPrice),
      expectedPrice: Number(call.strikePrice),
      success: true,
    });

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

    call.status = OracleCallStatus.OPEN;
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

    call.status = resolution;
    call.resolvedAt = new Date();
    call.processedAt = new Date();
    call.failedAt = null;
    if (finalPrice !== undefined) call.finalPrice = finalPrice;

    this.logger.log(`Call ${callId} FORCE-RESOLVED by admin → ${resolution}`);
    return this.oracleCallRepository.save(call);
  }

  // ─── Admin: Oracle Configuration ──────────────────────────────────────────

  async updateParams(
    feedId: string,
    params: { minResponses: number; heartbeatSeconds: number },
  ): Promise<{ success: boolean; feedId: string }> {
    this.logger.log(
      `Oracle params updated for feed ${feedId}: ${JSON.stringify(params)}`,
    );
    // In a real app, this would send a Soroban transaction
    return { success: true, feedId };
  }

  async setQuorum(
    roundId: string,
    quorum: number,
  ): Promise<{ success: boolean; roundId: string }> {
    this.logger.log(`Oracle quorum set for round ${roundId}: ${quorum}`);
    // In a real app, this would send a Soroban transaction
    return { success: true, roundId };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async findCallOrThrow(callId: number): Promise<OracleCall> {
    const call = await this.oracleCallRepository.findOne({
      where: { id: callId },
    });
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
