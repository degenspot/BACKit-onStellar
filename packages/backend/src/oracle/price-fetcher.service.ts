import { Injectable, Logger } from '@nestjs/common';
import { OracleOperationType } from './entities/oracle-health-log.entity';
import { OracleHealthService } from './oracle-health.service';

@Injectable()
export class PriceFetcherService {
  private readonly logger = new Logger(PriceFetcherService.name);

  constructor(private readonly oracleHealthService: OracleHealthService) {}

  /**
   * Fetch price for a given pair from DexScreener
   * @param pairAddress The address of the pair on Stellar
   * @param baseToken The address of the base token
   * @param quoteToken The address of the quote token
   * @returns The price of baseToken in terms of quoteToken
   */
  async fetchPrice(
    pairAddress: string,
    baseToken: string,
    quoteToken: string,
  ): Promise<number | null> {
    const submissionTime = new Date();

    try {
      this.logger.debug(`Fetching price for pair ${pairAddress}`);

      // Primary source: DexScreener
      const url = `https://api.dexscreener.com/latest/dex/pairs/stellar/${pairAddress}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`DexScreener API returned status ${response.status}`);
      }

      const data: any = await response.json();

      if (!data.pair || !data.pair.priceUsd) {
        this.logger.warn(`No price data found for pair ${pairAddress}`);
        await this.logFetch(
          pairAddress,
          submissionTime,
          false,
          null,
          `No price data found for pair ${pairAddress}`,
        );

        // Fallback or secondary check could be implemented here
        // For now, return null to signify failure
        return null;
      }

      const price = parseFloat(data.pair.priceUsd);
      this.logger.debug(`Fetched price: ${price} USD`);
      await this.logFetch(pairAddress, submissionTime, true, price);

      return price;
    } catch (error) {
      this.logger.error(`Error fetching price for ${pairAddress}:`, error);
      await this.logFetch(
        pairAddress,
        submissionTime,
        false,
        null,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private async logFetch(
    pairAddress: string,
    submissionTime: Date,
    success: boolean,
    priceFetched: number | null,
    errorMessage?: string,
  ): Promise<void> {
    await this.oracleHealthService.recordOperation({
      oracleKey: pairAddress,
      callId: null,
      operation: OracleOperationType.FETCH,
      submissionTime,
      priceFetched,
      success,
      errorMessage,
    });
  }
}
