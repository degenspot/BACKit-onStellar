import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, DeepPartial } from 'typeorm';
import { SorobanRpc, Contract, xdr } from '@stellar/stellar-sdk';
import { OracleCall, OracleCallStatus } from './entities/oracle-call.entity';
import { OracleOutcome } from './entities/oracle-outcome.entity';
import { retryWithBackoff, Retryable } from '../utils/retry';
import { REPORT_THRESHOLD } from '../calls/constants/moderation.constants';
import { OracleHealthService } from './oracle-health.service';
import {
  OracleOperationType,
  OracleHealthLog,
} from './entities/oracle-health-log.entity';
import { SigningService } from './signing.service';
import { IpfsService } from '../storage/ipfs.service';
import { Token } from '../token/entities/token.entity';
import { PriceDeviationLog } from './entities/log.entity';
import { PriceFetcherService } from './price-fetcher.service';
import { CoinGeckoService } from './coinGeko.service';

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
    @InjectRepository(Token)
    private readonly tokenRepository: Repository<Token>,
    @InjectRepository(PriceDeviationLog)
    private readonly priceDeviationLogRepository: Repository<PriceDeviationLog>,
    @InjectRepository(OracleHealthLog)
    private readonly oracleHealthLogRepository: Repository<OracleHealthLog>,
    private readonly oracleHealthService: OracleHealthService,
    private readonly signingService: SigningService,
    private readonly ipfsService: IpfsService,
    private readonly priceFetcherService: PriceFetcherService,
    private readonly coinGeckoService: CoinGeckoService,
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
  private async getAssetParams(tokenStr: string): Promise<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  } | null> {
    const upper = tokenStr.toUpperCase();
    if (upper === 'XLM' || upper === 'NATIVE') {
      return { asset_type: 'native' };
    }
    if (upper === 'USDC') {
      return {
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer:
          'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      };
    }
    if (upper === 'YXLM') {
      return {
        asset_type: 'credit_alphanum4',
        asset_code: 'yXLM',
        asset_issuer:
          'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55',
      };
    }

    if (tokenStr.includes(':') || tokenStr.includes('-')) {
      const parts = tokenStr.includes(':')
        ? tokenStr.split(':')
        : tokenStr.split('-');
      const code = parts[0];
      const issuer = parts[1];
      return {
        asset_type: code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12',
        asset_code: code,
        asset_issuer: issuer,
      };
    }

    try {
      const token = await this.tokenRepository.findOne({
        where: [{ assetCode: tokenStr }],
      });
      if (token) {
        if (!token.assetIssuer) {
          return { asset_type: 'native' };
        }
        return {
          asset_type:
            token.assetCode.length <= 4
              ? 'credit_alphanum4'
              : 'credit_alphanum12',
          asset_code: token.assetCode,
          asset_issuer: token.assetIssuer,
        };
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Failed lookup for tokenStr ${tokenStr}: ${errorMsg}`);
    }

    return null;
  }

  private async fetchHorizonMidpoint(call: OracleCall): Promise<number | null> {
    const selling = await this.getAssetParams(call.baseToken);
    const buying = await this.getAssetParams(call.quoteToken);

    if (!selling || !buying) {
      this.logger.log(
        `Cannot determine asset details for baseToken: ${call.baseToken}, quoteToken: ${call.quoteToken}`,
      );
      return null;
    }

    const params = new URLSearchParams();
    params.append('selling_asset_type', selling.asset_type);
    if (selling.asset_code)
      params.append('selling_asset_code', selling.asset_code);
    if (selling.asset_issuer)
      params.append('selling_asset_issuer', selling.asset_issuer);

    params.append('buying_asset_type', buying.asset_type);
    if (buying.asset_code)
      params.append('buying_asset_code', buying.asset_code);
    if (buying.asset_issuer)
      params.append('buying_asset_issuer', buying.asset_issuer);

    const horizonBase =
      process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
    const horizonUrl = `${horizonBase}/order_book?${params.toString()}`;

    const response = await fetch(horizonUrl);
    if (!response.ok) {
      this.logger.warn(
        `Horizon order book API returned status ${response.status}`,
      );
      return null;
    }

    const data = (await response.json()) as {
      bids?: Array<{ price: string }>;
      asks?: Array<{ price: string }>;
    };
    if (
      !data.bids ||
      data.bids.length === 0 ||
      !data.asks ||
      data.asks.length === 0
    ) {
      this.logger.log(`Horizon order book returned no bids or asks.`);
      return null;
    }

    const bestBid = parseFloat(data.bids[0].price);
    const bestAsk = parseFloat(data.asks[0].price);
    return (bestBid + bestAsk) / 2;
  }

  async getPriceSources(callId: number) {
    const call = await this.findCallOrThrow(callId);

    // 1. Get historical values from health logs
    const healthLog = await this.oracleHealthLogRepository.findOne({
      where: {
        callId: String(callId),
        operation: OracleOperationType.SUBMIT,
      },
      order: { submissionTime: 'DESC' },
    });

    // Get historical values from price deviation logs (CoinGecko)
    const deviationLog = await this.priceDeviationLogRepository.findOne({
      where: { symbol: call.baseToken.toUpperCase() },
      order: { checkedAt: 'DESC' },
    });

    // 2. Query live values as fallback or additional info
    let liveDexPrice: number | null = null;
    try {
      liveDexPrice = await this.priceFetcherService.fetchPrice(
        call.pairAddress,
        call.baseToken,
        call.quoteToken,
      );
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Failed to fetch live DexScreener price: ${errorMsg}`);
    }

    let liveHorizonPrice: number | null = null;
    try {
      liveHorizonPrice = await this.fetchHorizonMidpoint(call);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Failed to fetch live Horizon price: ${errorMsg}`);
    }

    let liveCoinGeckoPrice: number | null = null;
    try {
      const prices = await this.coinGeckoService.getPrices([call.baseToken]);
      liveCoinGeckoPrice = prices.get(call.baseToken.toUpperCase()) ?? null;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Failed to fetch live CoinGecko price: ${errorMsg}`);
    }

    return {
      callId: call.id,
      pairAddress: call.pairAddress,
      baseToken: call.baseToken,
      quoteToken: call.quoteToken,
      sources: [
        {
          source: 'DexScreener',
          value:
            healthLog?.dexScreenerPrice !== undefined &&
            healthLog?.dexScreenerPrice !== null
              ? Number(healthLog.dexScreenerPrice)
              : healthLog?.priceFetched !== undefined &&
                  healthLog?.priceFetched !== null
                ? Number(healthLog.priceFetched)
                : liveDexPrice,
        },
        {
          source: 'Horizon SDEX',
          value:
            healthLog?.horizonPrice !== undefined &&
            healthLog?.horizonPrice !== null
              ? Number(healthLog.horizonPrice)
              : liveHorizonPrice,
        },
        {
          source: 'CoinGecko',
          value:
            deviationLog?.referencePrice !== undefined &&
            deviationLog?.referencePrice !== null
              ? Number(deviationLog.referencePrice)
              : liveCoinGeckoPrice,
        },
      ],
    };
  }

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

    // ─── CROSS-CHECK: Horizon Orderbook Sanity Check ───────────────────────
    let horizonMidpoint: number | null = null;
    let skipCrossValidation = false;
    const dexPrice = parseFloat(observedPrice);

    try {
      horizonMidpoint = await this.fetchHorizonMidpoint(call);
      if (horizonMidpoint === null) {
        this.logger.log(
          `Skipping cross-validation for call ${callId}: no Horizon orderbook data or liquidity returned.`,
        );
        skipCrossValidation = true;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Horizon orderbook for call ${callId}: ${error instanceof Error ? error.message : String(error)}. Skipping cross-validation.`,
      );
      skipCrossValidation = true;
    }

    if (!skipCrossValidation && horizonMidpoint !== null) {
      const thresholdBps = Number(process.env.DEVIATION_THRESHOLD_BPS ?? 500);
      const threshold = thresholdBps / 10000;
      const deviation = Math.abs(dexPrice - horizonMidpoint) / horizonMidpoint;

      if (deviation > threshold) {
        this.logger.warn(
          `Price deviation exceeded threshold for call ${callId}: DexScreener = ${dexPrice}, Horizon Midpoint = ${horizonMidpoint}, deviation = ${(deviation * 100).toFixed(2)}%, threshold = ${(threshold * 100).toFixed(2)}%`,
        );

        // Mark the call for admin review
        call.needsAdminReview = true;
        call.failedAt = new Date();
        await this.oracleCallRepository.save(call);

        // Record failed operation in health logs
        await this.oracleHealthService.recordOperation({
          oracleKey: call.pairAddress,
          callId,
          operation: OracleOperationType.SUBMIT,
          submissionTime,
          priceFetched: dexPrice,
          expectedPrice: Number(call.strikePrice),
          success: false,
          errorMessage: `Price deviation exceeded threshold: DexScreener = ${dexPrice}, Horizon = ${horizonMidpoint}`,
          dexScreenerPrice: dexPrice,
          horizonPrice: horizonMidpoint,
        });

        throw new BadRequestException(
          `Market ${callId} resolution halted: price deviation between DexScreener (${dexPrice}) and Horizon midpoint (${horizonMidpoint}) exceeds threshold. Admin review required.`,
        );
      }
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
      this.logger.warn(
        `IPFS evidence pinning failed for call ${callId}, continuing`,
      );
    }

    await this.oracleOutcomeRepository.save(
      this.oracleOutcomeRepository.create({
        call,
        price: Number(observedPrice),
        outcome: outcome === OracleCallStatus.RESOLVED_YES ? 'YES' : 'NO',
        signature,
        transactionHash: undefined,
        evidence_cid: evidenceCid ?? undefined,
      } as DeepPartial<OracleOutcome>),
    );

    call.status = outcome;
    call.finalPrice = observedPrice;
    call.resolvedAt = new Date();
    call.processedAt = new Date();
    await this.oracleCallRepository.save(call);

    // Record successful operation in health logs (storing both prices)
    await this.oracleHealthService.recordOperation({
      oracleKey: call.pairAddress,
      callId,
      operation: OracleOperationType.SUBMIT,
      submissionTime,
      priceFetched: Number(observedPrice),
      expectedPrice: Number(call.strikePrice),
      success: true,
      dexScreenerPrice: Number(observedPrice),
      horizonPrice: horizonMidpoint,
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
    await Promise.resolve();
    // In a real app, this would send a Soroban transaction
    return { success: true, feedId };
  }

  async setQuorum(
    roundId: string,
    quorum: number,
  ): Promise<{ success: boolean; roundId: string }> {
    this.logger.log(`Oracle quorum set for round ${roundId}: ${quorum}`);
    await Promise.resolve();
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
