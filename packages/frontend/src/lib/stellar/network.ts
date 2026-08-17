/**
 * Network and stake-asset configuration.
 *
 * The stake asset is identified by issuer + asset code (or by its Stellar Asset
 * Contract id for contract calls). It is never matched on the symbol alone:
 * anybody can issue an asset called `USDC`, and paying attention only to the
 * code would let a worthless look-alike balance drive the stake amount.
 */

export type StellarNetwork = "PUBLIC" | "TESTNET";

export const NETWORK_PASSPHRASES: Record<StellarNetwork, string> = {
  PUBLIC: "Public Global Stellar Network ; September 2015",
  TESTNET: "Test SDF Network ; September 2015",
};

const DEFAULT_HORIZON: Record<StellarNetwork, string> = {
  PUBLIC: "https://horizon.stellar.org",
  TESTNET: "https://horizon-testnet.stellar.org",
};

/** Canonical circle.com USDC issuers, used when no override is configured. */
const DEFAULT_USDC_ISSUER: Record<StellarNetwork, string> = {
  PUBLIC: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  TESTNET: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

export interface StakeAsset {
  /** Asset code as it appears on the trustline, e.g. `USDC`. */
  code: string;
  /** Issuer account, or `null` for the native asset. */
  issuer: string | null;
  /** Stellar Asset Contract id, when the market settles through a SAC. */
  contractId: string | null;
  /** True when the stake asset is native XLM. */
  isNative: boolean;
}

export interface NetworkConfig {
  network: StellarNetwork;
  passphrase: string;
  horizonUrl: string;
  stakeAsset: StakeAsset;
  /**
   * Set when the deployment is misconfigured (for example a non-native asset
   * without an issuer). The UI must refuse to compute a MAX in that case.
   */
  configError: string | null;
}

/** Normalise the many spellings wallets use for a network name. */
export function normaliseNetwork(
  network: string | null | undefined,
): StellarNetwork {
  if (!network) return defaultNetwork();
  const value = network.trim().toUpperCase();
  if (value.includes("TEST")) return "TESTNET";
  if (value.includes("PUBLIC") || value.includes("MAIN")) return "PUBLIC";
  return defaultNetwork();
}

function defaultNetwork(): StellarNetwork {
  return process.env.NEXT_PUBLIC_STELLAR_NETWORK?.toUpperCase() === "PUBLIC"
    ? "PUBLIC"
    : "TESTNET";
}

function envFor(name: string, network: StellarNetwork): string | undefined {
  const suffixed =
    network === "PUBLIC"
      ? process.env[`${name}_PUBLIC` as keyof NodeJS.ProcessEnv]
      : process.env[`${name}_TESTNET` as keyof NodeJS.ProcessEnv];
  return (suffixed ?? process.env[name as keyof NodeJS.ProcessEnv]) as
    | string
    | undefined;
}

/**
 * Resolve the network configuration for the wallet's active network.
 * `overrides` lets a market pin its own stake asset.
 */
export function resolveNetworkConfig(
  network: string | null | undefined,
  overrides: Partial<StakeAsset> = {},
): NetworkConfig {
  const resolved = normaliseNetwork(network);

  const code = (
    overrides.code ??
    envFor("NEXT_PUBLIC_STAKE_ASSET_CODE", resolved) ??
    "USDC"
  ).trim();
  const isNative =
    overrides.isNative ?? (code.toUpperCase() === "XLM" || code === "native");
  // An explicit `issuer: null` override means "this market pins an asset with
  // no issuer configured", which must surface as an error rather than silently
  // falling back to the default issuer.
  const issuer = isNative
    ? null
    : "issuer" in overrides
      ? (overrides.issuer ?? null)
      : (envFor("NEXT_PUBLIC_STAKE_ASSET_ISSUER", resolved) ??
        DEFAULT_USDC_ISSUER[resolved] ??
        null);
  const contractId =
    overrides.contractId ??
    envFor("NEXT_PUBLIC_STAKE_ASSET_CONTRACT_ID", resolved) ??
    null;

  const configError =
    !isNative && !issuer
      ? `No issuer configured for stake asset ${code}. Set NEXT_PUBLIC_STAKE_ASSET_ISSUER.`
      : null;

  return {
    network: resolved,
    passphrase: NETWORK_PASSPHRASES[resolved],
    horizonUrl: (
      envFor("NEXT_PUBLIC_HORIZON_URL", resolved) ?? DEFAULT_HORIZON[resolved]
    ).replace(/\/$/, ""),
    stakeAsset: {
      code: isNative ? "XLM" : code,
      issuer,
      contractId,
      isNative,
    },
    configError,
  };
}

/** Horizon balance line, as returned by `GET /accounts/:id`. */
export interface HorizonBalanceLine {
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  is_authorized?: boolean;
  buying_liabilities?: string;
  selling_liabilities?: string;
}

/**
 * Find the balance line for a stake asset.
 *
 * Matches native by `asset_type`, and any other asset by issuer **and** code,
 * so a same-code asset from a different issuer is ignored.
 */
export function findAssetBalance(
  balances: HorizonBalanceLine[] | undefined,
  asset: StakeAsset,
): HorizonBalanceLine | undefined {
  if (!balances) return undefined;
  if (asset.isNative) {
    return balances.find((line) => line.asset_type === "native");
  }
  return balances.find(
    (line) =>
      line.asset_type !== "native" &&
      line.asset_code === asset.code &&
      line.asset_issuer === asset.issuer,
  );
}

/** Human label for the configured asset, e.g. `USDC (GA5Z…KZVN)`. */
export function describeAsset(asset: StakeAsset): string {
  if (asset.isNative) return "XLM";
  if (!asset.issuer) return asset.code;
  return `${asset.code} (${asset.issuer.slice(0, 4)}…${asset.issuer.slice(-4)})`;
}
