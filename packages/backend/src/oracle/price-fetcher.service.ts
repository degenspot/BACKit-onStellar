import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class PriceFetcherService {
    private readonly logger = new Logger(PriceFetcherService.name);

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

                // Fallback or secondary check could be implemented here
                // For now, return null to signify failure
                return null;
            }

            const price = parseFloat(data.pair.priceUsd);
            this.logger.debug(`Fetched price: ${price} USD`);

            return price;
        } catch (error) {
            this.logger.error(`Error fetching price for ${pairAddress}:`, error);
            return null;
        }
    }
}
