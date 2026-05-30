import { Injectable, Logger } from '@nestjs/common';
import { PRICE_DEVIATION_CONFIG } from './config/oracle.config';

export interface CoinGeckoPriceResult {
  symbol: string;
  coinId: string;
  usdPrice: number;
}

@Injectable()
export class CoinGeckoService {
  private readonly logger = new Logger(CoinGeckoService.name);
  private readonly cfg = PRICE_DEVIATION_CONFIG.coingecko;

  /**
   * Fetches current USD prices for all configured symbols in a single request.
   * Returns a map of symbol → usdPrice.
   */
  async getPrices(symbols: string[]): Promise<Map<string, number>> {
    const coinIds = symbols
      .map((s) => this.cfg.symbolToId[s.toUpperCase()])
      .filter(Boolean);

    if (!coinIds.length) {
      this.logger.warn(
        'No CoinGecko coin IDs mapped for symbols: ' + symbols.join(', '),
      );
      return new Map();
    }

    const url =
      `${this.cfg.baseUrl}/simple/price` +
      `?ids=${coinIds.join(',')}&vs_currencies=usd`;

    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(
        `CoinGecko request failed: ${res.status} ${res.statusText}`,
      );
    }

    const json = (await res.json()) as Record<string, { usd: number }>;

    const priceMap = new Map<string, number>();

    for (const symbol of symbols) {
      const coinId = this.cfg.symbolToId[symbol.toUpperCase()];
      if (coinId && json[coinId]?.usd !== undefined) {
        priceMap.set(symbol.toUpperCase(), json[coinId].usd);
      } else {
        this.logger.warn(
          `No CoinGecko price returned for ${symbol} (id: ${coinId})`,
        );
      }
    }

    return priceMap;
  }
}
