/**
 * Contract stake rules and the amount maths built on top of them.
 *
 * `call_registry` rejects a stake below `min_stake` and, when configured,
 * above `max_stake_per_user`. The presets and MAX have to respect both, or the
 * UI cheerfully offers an amount the contract will refuse.
 *
 * All amounts are stroops (`bigint`); nothing in this module touches a float.
 */

import { toStroops } from "../backend/amounts";

export interface StakeLimits {
  /** Smallest stake the contract accepts. */
  minStroops: bigint;
  /** Largest stake per user per position; `null` when unlimited. */
  maxStroops: bigint | null;
}

/** Matches `TEST_MIN_STAKE` in the contract: 0.1 units. */
export const DEFAULT_MIN_STAKE_STROOPS = 1_000_000n;

export interface StakeLimitsEnv {
  [key: string]: string | undefined;
  NEXT_PUBLIC_MIN_STAKE?: string;
  NEXT_PUBLIC_MAX_STAKE_PER_USER?: string;
  NEXT_PUBLIC_XLM_FEE_BUFFER?: string;
}

function parseDecimalEnv(value: string | undefined): bigint | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const stroops = toStroops(trimmed);
    return stroops >= 0n ? stroops : null;
  } catch {
    return null;
  }
}

/**
 * Read the contract stake limits from an env-like object.
 *
 * A malformed or missing value falls back to the contract default rather than
 * disabling the limit: an unenforced maximum is a failed transaction, an
 * unenforced minimum is a rejected one.
 */
export function parseStakeLimits(
  env: StakeLimitsEnv = process.env,
): StakeLimits {
  const min = parseDecimalEnv(env.NEXT_PUBLIC_MIN_STAKE);
  const max = parseDecimalEnv(env.NEXT_PUBLIC_MAX_STAKE_PER_USER);
  return {
    minStroops: min ?? DEFAULT_MIN_STAKE_STROOPS,
    // `0` means unlimited in the contract config, and so does an unset var.
    maxStroops: max !== null && max > 0n ? max : null,
  };
}

/** Read the XLM fee buffer override, in stroops. */
export function parseFeeBuffer(
  env: StakeLimitsEnv = process.env,
  fallback: bigint,
): bigint {
  return parseDecimalEnv(env.NEXT_PUBLIC_XLM_FEE_BUFFER) ?? fallback;
}

/**
 * The largest amount that is both affordable and acceptable to the contract.
 *
 * Returns `0n` when the spendable balance cannot even reach `min_stake`, so a
 * caller can tell "nothing to stake" apart from "some amount is available".
 */
export function computeMaxStakeStroops(
  spendableStroops: bigint,
  limits: StakeLimits,
): bigint {
  if (spendableStroops <= 0n) return 0n;

  const capped =
    limits.maxStroops !== null && spendableStroops > limits.maxStroops
      ? limits.maxStroops
      : spendableStroops;

  return capped >= limits.minStroops ? capped : 0n;
}

/**
 * A percentage of the spendable balance, clamped to the contract maximum.
 *
 * Truncating rather than rounding keeps the result at or below the balance:
 * a 100% preset that rounds up is a preset that cannot be submitted. The
 * result is *not* raised to the minimum — an amount below `min_stake` is
 * reported as such by {@link validateStakeAmount} instead of being silently
 * changed to something the user did not choose.
 */
export function computePercentStakeStroops(
  spendableStroops: bigint,
  percent: number,
  limits: StakeLimits,
): bigint {
  if (spendableStroops <= 0n || percent <= 0) return 0n;
  if (percent >= 100) return computeMaxStakeStroops(spendableStroops, limits);

  const raw = (spendableStroops * BigInt(Math.floor(percent))) / 100n;
  if (limits.maxStroops !== null && raw > limits.maxStroops)
    return limits.maxStroops;
  return raw;
}

export type StakeAmountProblem =
  | "invalid-amount"
  | "below-minimum"
  | "above-maximum"
  | "exceeds-balance"
  | "insufficient-fee"
  | "market-closed";

export type StakeAmountValidation =
  | { status: "ok" }
  | { status: "error"; problem: StakeAmountProblem };

export interface ValidateStakeAmountParams {
  /** Parsed amount, or `null` when the field could not be parsed. */
  amountStroops: bigint | null;
  /** Spendable stake-asset balance, or `null` when balances are unknown. */
  spendableStroops: bigint | null;
  limits: StakeLimits;
  /** Does the account hold enough XLM to pay the transaction fee? */
  hasFeeBuffer: boolean;
  /** Is the market still open for stakes? */
  marketActive: boolean;
}

/**
 * The first reason this amount cannot be submitted, in the order a user hits
 * them. Balance checks are skipped when balances are unknown so an unreachable
 * Horizon blocks nothing on its own — the network would reject an
 * unaffordable stake anyway, and pretending the balance is zero is worse.
 */
export function validateStakeAmount({
  amountStroops,
  spendableStroops,
  limits,
  hasFeeBuffer,
  marketActive,
}: ValidateStakeAmountParams): StakeAmountValidation {
  if (!marketActive) return { status: "error", problem: "market-closed" };
  if (amountStroops === null || amountStroops <= 0n) {
    return { status: "error", problem: "invalid-amount" };
  }
  if (amountStroops < limits.minStroops) {
    return { status: "error", problem: "below-minimum" };
  }
  if (limits.maxStroops !== null && amountStroops > limits.maxStroops) {
    return { status: "error", problem: "above-maximum" };
  }
  if (spendableStroops !== null && amountStroops > spendableStroops) {
    return { status: "error", problem: "exceeds-balance" };
  }
  if (!hasFeeBuffer) return { status: "error", problem: "insufficient-fee" };
  return { status: "ok" };
}
