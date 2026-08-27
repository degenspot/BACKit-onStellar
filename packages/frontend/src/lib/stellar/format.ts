/**
 * Display and input formatting for stake amounts.
 *
 * Two different jobs, deliberately kept apart:
 *   - {@link formatStakeAmount} / {@link formatXlmAmount} render a balance for
 *     a human. Lossy, and never parsed back.
 *   - {@link toAmountInputValue} renders stroops into the amount field. Exact:
 *     `toStroops(toAmountInputValue(x)) === x` for every non-negative `x`, so
 *     a MAX preset submits the balance to the stroop.
 */

import { ASSET_DECIMALS, fromStroops, formatAmount } from "../backend/amounts";

/** Stake-asset balances are shown to 2 decimals, as elsewhere in the app. */
export const STAKE_DISPLAY_DECIMALS = 2;
/** XLM fee amounts are small, so they get more places. */
export const XLM_DISPLAY_DECIMALS = 4;

/** Display-only: stake-asset amount with thousands separators. */
export function formatStakeAmount(stroops: bigint): string {
  return formatAmount(stroops, { decimals: STAKE_DISPLAY_DECIMALS });
}

/** Display-only: XLM amount. */
export function formatXlmAmount(stroops: bigint): string {
  return formatAmount(stroops, { decimals: XLM_DISPLAY_DECIMALS });
}

/** Drop trailing fractional zeros without changing the value. */
export function trimTrailingZeros(decimal: string): string {
  if (!decimal.includes(".")) return decimal;
  const trimmed = decimal.replace(/0+$/, "").replace(/\.$/, "");
  if (trimmed === "" || trimmed === "-") return "0";
  return trimmed;
}

/**
 * Exact, round-trippable representation of stroops for the amount field.
 * `1234500000n` → `"123.45"`, `1n` → `"0.0000001"`.
 */
export function toAmountInputValue(stroops: bigint): string {
  return trimTrailingZeros(fromStroops(stroops));
}

/**
 * Keep an amount field to something `toStroops` can parse while it is being
 * typed: digits, at most one decimal point, at most 7 decimal places.
 *
 * Truncating the 8th decimal here rather than at submission means the field
 * always shows the amount that will actually be staked.
 */
export function sanitizeAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [whole = "", ...rest] = cleaned.split(".");
  if (rest.length === 0) return whole;
  // `.5` is a decimal `toStroops` rejects, so the leading zero is restored.
  return `${whole || "0"}.${rest.join("").slice(0, ASSET_DECIMALS)}`;
}
