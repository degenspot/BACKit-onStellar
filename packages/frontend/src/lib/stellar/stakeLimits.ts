/**
 * Spendable-balance and stake-limit rules.
 *
 * All arithmetic is on stroops (`bigint`), so a MAX computed here is exactly
 * what can be submitted — no rounding surprise between the preview and the
 * transaction.
 */

import { maxStroops, minStroops, toStroops } from "./amounts";

/** Base reserve per account entry (0.5 XLM), as defined by the network. */
export const BASE_RESERVE_STROOPS = 5_000_000n;

/**
 * XLM kept aside for transaction fees on top of the protocol reserve.
 * Soroban invocations cost far more than the 100-stroop classic base fee, so
 * the default is deliberately generous and configurable.
 */
export const DEFAULT_FEE_BUFFER_STROOPS = toStroops(
  process.env.NEXT_PUBLIC_XLM_FEE_BUFFER ?? "1",
);

export interface StakeLimits {
  /** Contract minimum stake in stroops (`0` when unset). */
  minStroops: bigint;
  /** Contract maximum stake per user in stroops (`null` when uncapped). */
  maxStroops: bigint | null;
}

/** Limits from the environment, overridable per market. */
export function resolveStakeLimits(
  overrides: Partial<StakeLimits> = {},
): StakeLimits {
  const min =
    overrides.minStroops ?? toStroops(process.env.NEXT_PUBLIC_MIN_STAKE ?? "0");
  const configuredMax = process.env.NEXT_PUBLIC_MAX_STAKE_PER_USER;
  const max =
    overrides.maxStroops !== undefined
      ? overrides.maxStroops
      : configuredMax
        ? toStroops(configuredMax)
        : null;
  return { minStroops: min, maxStroops: max };
}

/**
 * XLM the account must keep: `(2 + subentries + sponsoring - sponsored)`
 * entries at the base reserve.
 */
export function requiredXlmReserveStroops({
  subentryCount = 0,
  numSponsoring = 0,
  numSponsored = 0,
}: {
  subentryCount?: number;
  numSponsoring?: number;
  numSponsored?: number;
}): bigint {
  const entries = BigInt(2 + subentryCount + numSponsoring - numSponsored);
  return maxStroops(entries, 0n) * BASE_RESERVE_STROOPS;
}

/** XLM that may actually be spent: balance minus reserve, floored at zero. */
export function spendableXlmStroops(
  nativeBalanceStroops: bigint,
  reserveStroops: bigint,
): bigint {
  return maxStroops(nativeBalanceStroops - reserveStroops, 0n);
}

export interface MaxStakeInput {
  /** Stake-asset balance in stroops. */
  assetBalanceStroops: bigint;
  /** Spendable XLM (balance minus reserve) in stroops. */
  spendableXlmStroops: bigint;
  /** True when the stake asset is XLM itself. */
  stakeAssetIsNative: boolean;
  limits: StakeLimits;
  feeBufferStroops?: bigint;
}

/**
 * The largest amount the wallet can stake right now.
 *
 * When the stake asset is XLM, the fee buffer is subtracted from the same
 * balance being staked; otherwise the fee buffer only gates whether staking is
 * possible at all and does not reduce the stake-asset amount.
 * Returns `0n` when nothing can be staked (the caller renders the reason).
 */
export function calculateMaxStakeStroops({
  assetBalanceStroops,
  spendableXlmStroops: spendableXlm,
  stakeAssetIsNative,
  limits,
  feeBufferStroops = DEFAULT_FEE_BUFFER_STROOPS,
}: MaxStakeInput): bigint {
  if (spendableXlm < feeBufferStroops) return 0n;

  const available = stakeAssetIsNative
    ? maxStroops(spendableXlm - feeBufferStroops, 0n)
    : assetBalanceStroops;

  const capped =
    limits.maxStroops !== null && limits.maxStroops > 0n
      ? minStroops(available, limits.maxStroops)
      : available;

  // A MAX below the contract minimum is not submittable, so offer nothing.
  return capped >= limits.minStroops ? capped : 0n;
}

export type StakeValidationReason =
  | "OK"
  | "WALLET_DISCONNECTED"
  | "BALANCE_UNAVAILABLE"
  | "ACCOUNT_NOT_FUNDED"
  | "MISSING_TRUSTLINE"
  | "ZERO_BALANCE"
  | "INSUFFICIENT_FEE_BALANCE"
  | "MARKET_CLOSED"
  | "AMOUNT_REQUIRED"
  | "AMOUNT_NOT_POSITIVE"
  | "BELOW_MINIMUM"
  | "ABOVE_MAXIMUM"
  | "EXCEEDS_BALANCE";

export interface StakeValidationInput {
  amountStroops: bigint | null;
  spendableStakeStroops: bigint;
  limits: StakeLimits;
  isConnected: boolean;
  marketIsActive: boolean;
  balanceReady: boolean;
  accountFunded: boolean;
  hasTrustline: boolean;
  hasFeeBalance: boolean;
}

export interface StakeValidation {
  reason: StakeValidationReason;
  canSubmit: boolean;
}

/**
 * Single source of truth for whether the stake button is enabled, ordered from
 * the most fundamental blocker (no wallet) to the most specific (amount).
 */
export function validateStake({
  amountStroops,
  spendableStakeStroops,
  limits,
  isConnected,
  marketIsActive,
  balanceReady,
  accountFunded,
  hasTrustline,
  hasFeeBalance,
}: StakeValidationInput): StakeValidation {
  const blocked = (reason: StakeValidationReason): StakeValidation => ({
    reason,
    canSubmit: false,
  });

  if (!isConnected) return blocked("WALLET_DISCONNECTED");
  if (!marketIsActive) return blocked("MARKET_CLOSED");
  if (!balanceReady) return blocked("BALANCE_UNAVAILABLE");
  if (!accountFunded) return blocked("ACCOUNT_NOT_FUNDED");
  if (!hasTrustline) return blocked("MISSING_TRUSTLINE");
  if (!hasFeeBalance) return blocked("INSUFFICIENT_FEE_BALANCE");
  if (spendableStakeStroops <= 0n) return blocked("ZERO_BALANCE");
  if (amountStroops === null) return blocked("AMOUNT_REQUIRED");
  if (amountStroops <= 0n) return blocked("AMOUNT_NOT_POSITIVE");
  if (amountStroops < limits.minStroops) return blocked("BELOW_MINIMUM");
  if (
    limits.maxStroops !== null &&
    limits.maxStroops > 0n &&
    amountStroops > limits.maxStroops
  ) {
    return blocked("ABOVE_MAXIMUM");
  }
  if (amountStroops > spendableStakeStroops) return blocked("EXCEEDS_BALANCE");

  return { reason: "OK", canSubmit: true };
}
