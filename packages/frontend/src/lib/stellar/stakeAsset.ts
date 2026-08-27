/**
 * Identity of the asset a market's pool is denominated in.
 *
 * A stake asset is never identified by its symbol: `USDC` is issued by many
 * accounts, and staking against the wrong issuer moves real money to a
 * worthless trustline. The canonical identity here is `CODE:ISSUER` (or
 * `native` for XLM), with the Stellar Asset Contract (SAC) ID carried
 * alongside for the Soroban path.
 *
 * Everything is a pure function of an env-like object so the resolution rules
 * can be unit tested without touching `process.env`.
 */

import { isValidContractId, type StellarNetworkName } from "../networkConfig";

export type StakeAssetType = "native" | "credit";

export interface StakeAsset {
  type: StakeAssetType;
  /** Asset code, e.g. `USDC`. `XLM` for the native asset. */
  code: string;
  /** Issuing account for a credit asset; `null` for XLM. */
  issuer: string | null;
  /** SAC wrapper the contracts transact through, when configured. */
  sacContractId: string | null;
  /** Canonical identity: `CODE:ISSUER`, or `native`. */
  id: string;
}

export type StakeAssetResult =
  | { status: "ok"; asset: StakeAsset }
  | { status: "error"; errors: string[] };

/** Stellar account IDs are 56 base32 chars starting with `G`. */
const ACCOUNT_ID_PATTERN = /^G[A-Z2-7]{55}$/;
/** Classic asset codes are 1–12 alphanumeric characters. */
const ASSET_CODE_PATTERN = /^[A-Za-z0-9]{1,12}$/;

/**
 * Issuers of the USDC each network is expected to use, so a deployment that
 * only sets the network still validates against a real issuer rather than
 * trusting the `USDC` symbol.
 */
const DEFAULT_STAKE_ISSUERS: Partial<Record<StellarNetworkName, string>> = {
  PUBLIC: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  TESTNET: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

const DEFAULT_STAKE_ASSET_CODE = "USDC";

export interface StakeAssetEnv {
  [key: string]: string | undefined;
  NEXT_PUBLIC_STAKE_ASSET_CODE?: string;
  NEXT_PUBLIC_STAKE_ASSET_ISSUER?: string;
  NEXT_PUBLIC_USDC_SAC_CONTRACT_ID?: string;
}

export function isValidIssuer(value: unknown): value is string {
  return typeof value === "string" && ACCOUNT_ID_PATTERN.test(value);
}

export function isValidAssetCode(value: unknown): value is string {
  return typeof value === "string" && ASSET_CODE_PATTERN.test(value);
}

/** Build the native (XLM) stake asset descriptor. */
export function nativeStakeAsset(
  sacContractId: string | null = null,
): StakeAsset {
  return {
    type: "native",
    code: "XLM",
    issuer: null,
    sacContractId,
    id: "native",
  };
}

/**
 * Resolve the configured stake asset for a network.
 *
 * A credit asset requires a well-formed issuer: without one the app cannot
 * tell the intended USDC apart from an impostor, so this reports a config
 * error rather than falling back to a symbol match.
 */
export function parseStakeAsset(
  env: StakeAssetEnv,
  network: StellarNetworkName,
): StakeAssetResult {
  const errors: string[] = [];

  const rawCode =
    env.NEXT_PUBLIC_STAKE_ASSET_CODE?.trim() || DEFAULT_STAKE_ASSET_CODE;
  const rawIssuer =
    env.NEXT_PUBLIC_STAKE_ASSET_ISSUER?.trim() ||
    DEFAULT_STAKE_ISSUERS[network] ||
    "";
  const rawSac = env.NEXT_PUBLIC_USDC_SAC_CONTRACT_ID?.trim() || "";

  if (rawSac && !isValidContractId(rawSac)) {
    errors.push(
      `NEXT_PUBLIC_USDC_SAC_CONTRACT_ID "${rawSac}" is not a valid Stellar contract ID.`,
    );
  }
  const sacContractId = rawSac && isValidContractId(rawSac) ? rawSac : null;

  if (rawCode.toUpperCase() === "XLM" && !rawIssuer) {
    if (errors.length > 0) return { status: "error", errors };
    return { status: "ok", asset: nativeStakeAsset(sacContractId) };
  }

  if (!isValidAssetCode(rawCode)) {
    errors.push(
      `NEXT_PUBLIC_STAKE_ASSET_CODE "${rawCode}" is not a valid Stellar asset code.`,
    );
  }
  if (!rawIssuer) {
    errors.push(
      `NEXT_PUBLIC_STAKE_ASSET_ISSUER is required for ${rawCode} on ${network}: ` +
        `an asset code alone does not identify an issued asset.`,
    );
  } else if (!isValidIssuer(rawIssuer)) {
    errors.push(
      `NEXT_PUBLIC_STAKE_ASSET_ISSUER "${rawIssuer}" is not a valid Stellar account ID.`,
    );
  }

  if (errors.length > 0) return { status: "error", errors };

  return {
    status: "ok",
    asset: {
      type: "credit",
      code: rawCode,
      issuer: rawIssuer,
      sacContractId,
      id: `${rawCode}:${rawIssuer}`,
    },
  };
}

let cachedAssets = new Map<StellarNetworkName, StakeAssetResult>();

/** Resolve (and memoise) the stake asset for a network from `process.env`. */
export function getStakeAsset(network: StellarNetworkName): StakeAssetResult {
  const cached = cachedAssets.get(network);
  if (cached) return cached;
  const resolved = parseStakeAsset(process.env, network);
  cachedAssets.set(network, resolved);
  return resolved;
}

/** Reset the memoised stake assets (used by tests). */
export function resetStakeAssetCache(): void {
  cachedAssets = new Map();
}

/** Short, human-readable identity, e.g. `USDC (GA5Z…KZVN)`. */
export function describeStakeAsset(asset: StakeAsset): string {
  if (asset.type === "native") return "XLM";
  const issuer = asset.issuer ?? "";
  return `${asset.code} (${issuer.slice(0, 4)}…${issuer.slice(-4)})`;
}

/**
 * Does the asset code a market reports match the configured stake asset?
 *
 * The market only carries a symbol, so this can rule a market *out* but never
 * confirms the issuer — that check belongs to the balance lookup, which
 * matches on `CODE:ISSUER`.
 */
export function marketAssetMatches(
  stakeToken: string | null | undefined,
  asset: StakeAsset,
): boolean {
  if (!stakeToken) return false;
  return stakeToken.trim().toUpperCase() === asset.code.toUpperCase();
}
