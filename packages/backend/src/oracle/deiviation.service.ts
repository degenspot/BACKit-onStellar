import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PRICE_DEVIATION_CONFIG } from './config/oracle.config';
import { PriceDeviationLog } from './entities/log.entity';
import { CoinGeckoService } from './coinGeko.service';

export interface OraclePrice {
  symbol: string;
  usdPrice: number;
}

export interface DeviationCheckResult {
  symbol: string;
  oraclePrice: number;
  referencePrice: number;
  deviationPercent: number;
  breached: boolean;
}

@Injectable()
export class PriceDeviationService {
  private readonly logger = new Logger(PriceDeviationService.name);
  private readonly threshold = PRICE_DEVIATION_CONFIG.thresholdPercent;

  /**
   * In-memory signing halt flag.
   *
   * Set to true when any symbol breaches the threshold. Your signing service
   * should call `isSigningHalted()` before producing a signature.
   *
   * Reset to false by calling `clearHalt()` after manual review.
   */
  private signingHalted = false;

  constructor(
    private readonly coinGecko: CoinGeckoService,

    @InjectRepository(PriceDeviationLog)
    private readonly logRepo: Repository<PriceDeviationLog>,
  ) {}

  isSigningHalted(): boolean {
    return this.signingHalted;
  }

  /** Call this after an operator has reviewed and cleared the alert. */
  clearHalt(): void {
    this.logger.log('Signing halt cleared by operator.');
    this.signingHalted = false;
  }

  /**
   * Main entry point called by the worker.
   * Fetches reference prices, computes deviations, persists audit rows, and
   * halts signing if any symbol exceeds the threshold.
   */
  async runDeviationCheck(
    oraclePrices: OraclePrice[],
  ): Promise<DeviationCheckResult[]> {
    const symbols = oraclePrices.map((p) => p.symbol);
    const referencePrices = await this.coinGecko.getPrices(symbols);

    const results: DeviationCheckResult[] = [];

    for (const { symbol, usdPrice: oraclePrice } of oraclePrices) {
      const referencePrice = referencePrices.get(symbol.toUpperCase());

      if (referencePrice === undefined) {
        this.logger.warn(
          `Skipping deviation check for ${symbol}: no reference price available.`,
        );
        continue;
      }

      const deviationPercent = this.calcDeviationPercent(
        oraclePrice,
        referencePrice,
      );
      const breached = deviationPercent > this.threshold;

      const result: DeviationCheckResult = {
        symbol,
        oraclePrice,
        referencePrice,
        deviationPercent,
        breached,
      };

      results.push(result);

      await this.persistLog(result);

      if (breached) {
        this.handleBreach(result);
      } else {
        this.logger.debug(
          `[${symbol}] deviation ${deviationPercent.toFixed(2)}% — within threshold (${this.threshold}%).`,
        );
      }
    }

    return results;
  }

  private calcDeviationPercent(oracle: number, reference: number): number {
    if (reference === 0) return 0;
    return Math.abs((oracle - reference) / reference) * 100;
  }

  private handleBreach(result: DeviationCheckResult): void {
    this.signingHalted = true;

    // Structured log — pipe this to your alerting stack (PagerDuty, Slack webhook, etc.)
    this.logger.error(
      JSON.stringify({
        alert: 'PRICE_DEVIATION_BREACH',
        symbol: result.symbol,
        oraclePrice: result.oraclePrice,
        referencePrice: result.referencePrice,
        deviationPercent: result.deviationPercent.toFixed(4),
        thresholdPercent: this.threshold,
        signingHalted: true,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  private async persistLog(result: DeviationCheckResult): Promise<void> {
    const log = this.logRepo.create({
      symbol: result.symbol,
      oraclePrice: result.oraclePrice,
      referencePrice: result.referencePrice,
      deviationPercent: result.deviationPercent,
      thresholdPercent: this.threshold,
      breached: result.breached,
      signingHalted: result.breached ? true : this.signingHalted,
    });

    await this.logRepo.save(log);
  }
}
