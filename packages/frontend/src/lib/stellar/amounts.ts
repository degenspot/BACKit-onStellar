/**
 * Stellar amount helpers.
 *
 * Stellar assets carry exactly 7 decimal places, so every balance and stake in
 * the app is held as an integer number of stroops (`bigint`) and only turned
 * into text for display. No balance arithmetic goes through a float.
 */

export const STELLAR_DECIMALS = 7;
const SCALE = 10n ** BigInt(STELLAR_DECIMALS);

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export class InvalidAmountError extends Error {
  constructor(value: unknown) {
    super(`Invalid Stellar amount: ${JSON.stringify(value)}`);
    this.name = "InvalidAmountError";
  }
}

/**
 * Parse a decimal string (as returned by Horizon) into stroops.
 * Precision beyond 7 decimals is truncated, never rounded up.
 */
export function toStroops(value: string): bigint {
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) throw new InvalidAmountError(value);

  const negative = trimmed.startsWith("-");
  const [whole, fraction = ""] = trimmed.replace("-", "").split(".");
  const padded = (fraction + "0".repeat(STELLAR_DECIMALS)).slice(
    0,
    STELLAR_DECIMALS,
  );
  const stroops = BigInt(whole) * SCALE + BigInt(padded || "0");
  return negative ? -stroops : stroops;
}

/** Parse user input, returning `null` instead of throwing on junk. */
export function parseAmountInput(value: string): bigint | null {
  if (!value.trim()) return null;
  try {
    return toStroops(value);
  } catch {
    return null;
  }
}

/** Render stroops as a full-precision decimal string (7 decimals). */
export function fromStroops(stroops: bigint): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(STELLAR_DECIMALS, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * Render stroops for display, truncated to `decimals` places and grouped.
 * Display-only: never feed the result back into stake math.
 */
export function formatStroops(
  stroops: bigint,
  {
    decimals = 2,
    grouping = true,
  }: { decimals?: number; grouping?: boolean } = {},
): string {
  const factor = 10n ** BigInt(decimals);
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const scaled = (abs * factor) / SCALE;
  const whole = (scaled / factor).toString();
  const fraction = (scaled % factor).toString().padStart(decimals, "0");
  const groupedWhole = grouping
    ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : whole;
  return `${negative ? "-" : ""}${groupedWhole}${decimals > 0 ? `.${fraction}` : ""}`;
}

/** Truncate an input string to the amount of decimals Stellar accepts. */
export function clampInputPrecision(value: string): string {
  const [whole, fraction] = value.split(".");
  if (fraction === undefined) return value;
  return `${whole}.${fraction.slice(0, STELLAR_DECIMALS)}`;
}

/** `stroops * percent / 100`, truncated — used by the 25/50/75% presets. */
export function percentOf(stroops: bigint, percent: number): bigint {
  if (!Number.isInteger(percent) || percent < 0) {
    throw new InvalidAmountError(percent);
  }
  return (stroops * BigInt(percent)) / 100n;
}

export function maxStroops(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function minStroops(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
