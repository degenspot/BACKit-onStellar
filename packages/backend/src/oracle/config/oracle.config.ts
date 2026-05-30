export interface OracleConfig {
  // Polling interval in milliseconds (default: 30000 = 30 seconds)
  pollIntervalMs: number;

  // Maximum retry attempts for failed calls
  maxRetries: number;

  // DexScreener API settings
  dexscreenerBaseUrl: string;
  dexscreenerTimeoutMs: number;

  // Signing configuration
  signingAlgorithm: 'ed25519'; // Future: support for other algorithms

  // Contract settings
  outcomeManagerContractAddress: string;
  contractNetwork: string; // 'stellar', 'ethereum', etc.
}

export const defaultOracleConfig: OracleConfig = {
  pollIntervalMs: 30000,
  maxRetries: 3,
  dexscreenerBaseUrl: 'https://api.dexscreener.com/latest/dex/pairs',
  dexscreenerTimeoutMs: 10000,
  signingAlgorithm: 'ed25519',
  outcomeManagerContractAddress:
    process.env.OUTCOME_MANAGER_CONTRACT_ADDRESS || '',
  contractNetwork: process.env.CONTRACT_NETWORK || 'stellar',
};

export const PRICE_DEVIATION_CONFIG = {
  /**
   * Maximum allowed percentage difference between the oracle price and the
   * CoinGecko reference price before signing is halted.
   * e.g. 0.05 = 5 %
   */
  thresholdPercent: Number(process.env.PRICE_DEVIATION_THRESHOLD_PERCENT ?? 5),

  /** How often the worker polls, in milliseconds (default: every 60 s). */
  cronExpression: process.env.PRICE_DEVIATION_CRON ?? '*/60 * * * * *',

  coingecko: {
    baseUrl: 'https://api.coingecko.com/api/v3',
    /**
     * Map your internal asset symbols to their CoinGecko coin IDs.
     * Extend as you add more assets.
     */
    symbolToId: {
      XLM: 'stellar',
      BTC: 'bitcoin',
      ETH: 'ethereum',
    } as Record<string, string>,
  },
} as const;
