/**
 * Monetary helpers for API payloads.
 *
 * Stellar assets carry 7 decimal places, so every amount is transported as a
 * decimal string and handled internally as an integer number of stroops
 * (1 unit = 10^7 stroops) using `bigint`. Nothing in this module converts an
 * amount to a JavaScript float, which keeps sums and odds exact.
 */

export const ASSET_DECIMALS = 7;
const SCALE = 10n ** BigInt(ASSET_DECIMALS);

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export class AmountFormatError extends Error {
  constructor(value: unknown) {
    super(`Invalid decimal amount: ${JSON.stringify(value)}`);
    this.name = "AmountFormatError";
  }
}

/**
 * Parse a decimal string into stroops.
 *
 * Extra precision beyond 7 decimals is truncated (never rounded up), matching
 * how the Stellar network itself treats sub-stroop amounts.
 */
export function toStroops(value: string): bigint {
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) throw new AmountFormatError(value);

  const negative = trimmed.startsWith("-");
  const [whole, fraction = ""] = trimmed.replace("-", "").split(".");
  const padded = (fraction + "0".repeat(ASSET_DECIMALS)).slice(
    0,
    ASSET_DECIMALS,
  );
  const stroops = BigInt(whole) * SCALE + BigInt(padded || "0");
  return negative ? -stroops : stroops;
}

/** Render stroops as a canonical, non-lossy decimal string (7 decimals). */
export function fromStroops(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(ASSET_DECIMALS, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Normalise a value coming from the API into stroops.
 *
 * Decimal strings are the contract; plain numbers are accepted because some
 * existing endpoints still serialise amounts as JSON numbers (see the API
 * contract gaps documented in the frontend README).
 */
export function amountFromApi(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string") return toStroops(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new AmountFormatError(value);
    return toStroops(value.toFixed(ASSET_DECIMALS));
  }
  if (value === null || value === undefined) return 0n;
  throw new AmountFormatError(value);
}

/** Same as {@link amountFromApi} but returns `null` for missing values. */
export function optionalAmountFromApi(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  return amountFromApi(value);
}

export function sumStroops(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

/**
 * Exact integer division rendered as a decimal string with `decimals` places
 * (truncated). Used for odds multipliers, which must be deterministic.
 */
export function divideToDecimalString(
  numerator: bigint,
  denominator: bigint,
  decimals: number,
): string {
  if (denominator === 0n) throw new Error("Division by zero");
  const factor = 10n ** BigInt(decimals);
  const scaled = (numerator * factor) / denominator;
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / factor;
  const fraction = (abs % factor).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}${decimals > 0 ? `.${fraction}` : ""}`;
}

/**
 * Format stroops for display, e.g. `1234.5670000` → `1,234.57`.
 * Display-only: the returned string must never be fed back into stake math.
 */
export function formatAmount(
  stroops: bigint,
  options: { decimals?: number; grouping?: boolean } = {},
): string {
  const { decimals = 2, grouping = true } = options;
  const rendered = divideToDecimalString(stroops, SCALE, decimals);
  if (!grouping) return rendered;

  const [whole, fraction] = rendered.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** Convenience for chart/aria values where a float is acceptable. */
export function stroopsToNumber(stroops: bigint): number {
  return Number(divideToDecimalString(stroops, SCALE, ASSET_DECIMALS));
}
