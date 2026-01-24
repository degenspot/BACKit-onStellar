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
