export interface EnvConfig {
  DATABASE_URL?: string;
  SOROBAN_RPC_URL?: string;
  ORACLE_SIGNER_SECRET?: string;
  CALL_REGISTRY_CONTRACT_ID?: string;
  OUTCOME_MANAGER_CONTRACT_ID?: string;
  JWT_SECRET?: string;
  PORT?: number;
  NODE_ENV?: string;
}

export const validateEnv = (config: Record<string, unknown>): EnvConfig => {
  const port = config.PORT ? parseInt(String(config.PORT), 10) : 3001;
  const nodeEnv = (config.NODE_ENV as string) || 'development';
  const jwtSecret =
    (config.JWT_SECRET as string) || 'super-secret-jwt-token-key-32-chars-min!';

  if (config.DATABASE_URL && typeof config.DATABASE_URL !== 'string') {
    console.error('Invalid DATABASE_URL');
  }

  return {
    DATABASE_URL: config.DATABASE_URL as string,
    SOROBAN_RPC_URL: config.SOROBAN_RPC_URL as string,
    ORACLE_SIGNER_SECRET: config.ORACLE_SIGNER_SECRET as string,
    CALL_REGISTRY_CONTRACT_ID: config.CALL_REGISTRY_CONTRACT_ID as string,
    OUTCOME_MANAGER_CONTRACT_ID: config.OUTCOME_MANAGER_CONTRACT_ID as string,
    JWT_SECRET: jwtSecret,
    PORT: port,
    NODE_ENV: nodeEnv,
  };
};
