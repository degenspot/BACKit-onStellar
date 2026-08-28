/**
 * Turn a Horizon account into the numbers the staking screen actually needs.
 *
 * Every amount stays a `bigint` of stroops (1 unit = 10^7 stroops) so nothing
 * here loses Stellar's 7-decimal precision; formatting for display happens at
 * the very edge, in the components.
 *
 * "Spendable" is deliberately narrower than "balance":
 *   - Stellar holds part of an account's XLM as the base reserve, which cannot
 *     be sent without closing the account,
 *   - open offers lock funds as selling liabilities, and
 *   - the account still has to pay the fee for the stake transaction itself.
 *
 * Offering a MAX built on the raw balance is how a wallet produces a
 * transaction that is guaranteed to fail.
 */

import { toStroops } from "../backend/amounts";
import type { HorizonAccount, HorizonBalanceLine } from "./horizon";
import type { StakeAsset } from "./stakeAsset";

/** Stellar's base reserve: 0.5 XLM per required entry. */
export const BASE_RESERVE_STROOPS = 5_000_000n;
/** Every account reserves two base reserves before any subentry. */
export const BASE_RESERVE_ENTRIES = 2n;
/** XLM held back so the account can still pay for the stake transaction. */
export const DEFAULT_FEE_BUFFER_STROOPS = 1_000_000n; // 0.1 XLM

/** A snapshot older than this is shown with a stale-data warning. */
export const STALE_AFTER_MS = 60_000;

export interface BalanceSnapshot {
  address: string;
  /** Canonical `CODE:ISSUER` of the asset the balances were read for. */
  assetId: string;
  /** Native XLM balance, before reserves and liabilities. */
  nativeStroops: bigint;
  /** XLM locked by the base reserve and subentries. */
  reservedNativeStroops: bigint;
  /** Native XLM the account may actually move. */
  spendableNativeStroops: bigint;
  /** Stake-asset balance, or `null` when the account holds no trustline. */
  stakeAssetStroops: bigint | null;
  /** Stake-asset balance the account may actually stake. */
  spendableStakeStroops: bigint;
  /** Does the account hold (and is it authorized on) the stake asset? */
  hasTrustline: boolean;
  /** A trustline exists but the issuer has not authorized it. */
  trustlineUnauthorized: boolean;
  /** XLM held back for fees in this snapshot. */
  feeBufferStroops: bigint;
  /** Can the account cover the fee buffer? */
  hasFeeBuffer: boolean;
  /** `Date.now()` when the underlying Horizon read completed. */
  fetchedAt: number;
}

function clampToZero(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

/** Parse a Horizon decimal string, treating anything malformed as zero. */
function parseStroops(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return toStroops(value);
  } catch {
    return 0n;
  }
}

/**
 * Does this balance line hold the configured stake asset?
 *
 * Matching is on `asset_code` **and** `asset_issuer` together — a line whose
 * code matches but whose issuer does not is a different asset that happens to
 * share a ticker, and must not be counted.
 */
export function balanceLineMatchesAsset(
  line: HorizonBalanceLine,
  asset: StakeAsset,
): boolean {
  if (asset.type === "native") return line.asset_type === "native";
  if (line.asset_type === "native") return false;
  return line.asset_code === asset.code && line.asset_issuer === asset.issuer;
}

export function findNativeLine(
  account: HorizonAccount,
): HorizonBalanceLine | undefined {
  return account.balances.find((line) => line.asset_type === "native");
}

export function findStakeAssetLine(
  account: HorizonAccount,
  asset: StakeAsset,
): HorizonBalanceLine | undefined {
  return account.balances.find((line) => balanceLineMatchesAsset(line, asset));
}

/**
 * Minimum XLM the account must retain:
 * `(2 + subentries + sponsoring - sponsored) * base reserve`.
 */
export function computeReservedNativeStroops(account: HorizonAccount): bigint {
  const entries =
    BASE_RESERVE_ENTRIES +
    BigInt(account.subentry_count ?? 0) +
    BigInt(account.num_sponsoring ?? 0) -
    BigInt(account.num_sponsored ?? 0);
  return clampToZero(entries) * BASE_RESERVE_STROOPS;
}

export interface DeriveBalanceSnapshotParams {
  account: HorizonAccount;
  asset: StakeAsset;
  address: string;
  fetchedAt: number;
  feeBufferStroops?: bigint;
}

/** Derive the spendable view of an account for one stake asset. */
export function deriveBalanceSnapshot({
  account,
  asset,
  address,
  fetchedAt,
  feeBufferStroops = DEFAULT_FEE_BUFFER_STROOPS,
}: DeriveBalanceSnapshotParams): BalanceSnapshot {
  const nativeLine = findNativeLine(account);
  const nativeStroops = parseStroops(nativeLine?.balance);
  const nativeLiabilities = parseStroops(nativeLine?.selling_liabilities);
  const reservedNativeStroops = computeReservedNativeStroops(account);
  const spendableNativeStroops = clampToZero(
    nativeStroops - reservedNativeStroops - nativeLiabilities,
  );
  const hasFeeBuffer = spendableNativeStroops >= feeBufferStroops;

  if (asset.type === "native") {
    // Staking XLM competes with the fee for the same balance, so the reserve
    // and the fee buffer both come off the top.
    return {
      address,
      assetId: asset.id,
      nativeStroops,
      reservedNativeStroops,
      spendableNativeStroops,
      stakeAssetStroops: nativeStroops,
      spendableStakeStroops: clampToZero(
        spendableNativeStroops - feeBufferStroops,
      ),
      hasTrustline: true,
      trustlineUnauthorized: false,
      feeBufferStroops,
      hasFeeBuffer,
      fetchedAt,
    };
  }

  const stakeLine = findStakeAssetLine(account, asset);
  // `is_authorized` is absent on assets whose issuer does not require
  // authorization, which means authorized.
  const authorized = stakeLine ? stakeLine.is_authorized !== false : false;
  const stakeAssetStroops = stakeLine ? parseStroops(stakeLine.balance) : null;
  const stakeLiabilities = parseStroops(stakeLine?.selling_liabilities);

  return {
    address,
    assetId: asset.id,
    nativeStroops,
    reservedNativeStroops,
    spendableNativeStroops,
    stakeAssetStroops,
    spendableStakeStroops:
      stakeAssetStroops !== null && authorized
        ? clampToZero(stakeAssetStroops - stakeLiabilities)
        : 0n,
    hasTrustline: stakeLine !== undefined && authorized,
    trustlineUnauthorized: stakeLine !== undefined && !authorized,
    feeBufferStroops,
    hasFeeBuffer,
    fetchedAt,
  };
}

/** Is a snapshot old enough that the UI should warn before staking on it? */
export function isSnapshotStale(
  snapshot: Pick<BalanceSnapshot, "fetchedAt">,
  now: number,
  staleAfterMs: number = STALE_AFTER_MS,
): boolean {
  return now - snapshot.fetchedAt >= staleAfterMs;
}
