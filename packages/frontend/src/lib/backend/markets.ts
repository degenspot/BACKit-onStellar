/**
 * Market (call) detail client.
 *
 * Backed by the NestJS API. Amounts arrive as decimal strings (or, for the
 * endpoints that still serialise them as JSON numbers, are normalised on
 * arrival) and are kept as stroops so odds and pool totals stay exact.
 */

import { apiFetch, type ApiFetchOptions } from "./http";
import {
  amountFromApi,
  divideToDecimalString,
  optionalAmountFromApi,
} from "./amounts";

export type MarketOutcome = "YES" | "NO" | "PENDING";

/** Raw shape returned by `GET /calls/:id`. */
export interface MarketResponseDto {
  id: string;
  title: string;
  description?: string | null;
  thesis?: string | null;
  creatorAddress: string;
  status?: string | null;
  outcome?: MarketOutcome | null;
  /** Scheduled close time — `endsAt` on the calls entity, `expiresAt` on the analytics view. */
  endsAt?: string | null;
  expiresAt?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  contractAddress?: string | null;
  stakeToken?: string | null;
  pairId?: string | null;
  tokenSymbol?: string | null;
  condition?: string | null;
  conditionJson?: Record<string, unknown> | null;
  /** Decimal strings (preferred) or JSON numbers (legacy). */
  totalYesStake?: string | number | null;
  totalNoStake?: string | number | null;
  currentPrice?: string | number | null;
  startPrice?: string | number | null;
  targetPrice?: string | number | null;
  finalPrice?: string | number | null;
  isBookmarked?: boolean;
  bookmarkCount?: number;
}

/** Normalised market used across the market-detail screen. */
export interface Market {
  id: string;
  title: string;
  thesis: string;
  condition: string;
  conditionJson: Record<string, unknown> | null;
  creatorAddress: string;
  pairId: string | null;
  tokenSymbol: string | null;
  /** Asset code the pool is denominated in, e.g. `USDC`. */
  stakeToken: string;
  contractAddress: string | null;
  status: string;
  outcome: MarketOutcome;
  resolved: boolean;
  endTime: string | null;
  resolvedAt: string | null;
  createdAt: string;
  totalYesStroops: bigint;
  totalNoStroops: bigint;
  /** Decimal strings — price feeds are not stake amounts, so they stay strings. */
  currentPrice: string | null;
  startPrice: string | null;
  targetPrice: string | null;
  isBookmarked: boolean;
  bookmarkCount: number;
}

/** Raw shape returned by `GET /calls/:id/stakes`. */
export interface MarketStakeDto {
  id?: string;
  userAddress?: string;
  address?: string;
  position?: "YES" | "NO";
  side?: "YES" | "NO";
  amount?: string | number;
  createdAt?: string;
  timestamp?: string;
  transactionHash?: string | null;
  txHash?: string | null;
  comment?: string | null;
}

/** A stake shown in the market activity log. */
export interface MarketStake {
  address: string;
  side: "YES" | "NO";
  amountStroops: bigint;
  timestamp: string;
  txHash: string;
  comment?: string;
}

/** Parimutuel odds derived from the persisted pool totals. */
export interface MarketOdds {
  /** Multiplier as a 4-decimal string, e.g. `"1.5667"`. */
  yes: string;
  no: string;
  totalPoolStroops: bigint;
}

const ODDS_DECIMALS = 4;
/** Multiplier used when a side is empty: the pool cannot pay more than 1:1 yet. */
const EMPTY_SIDE_ODDS = "2.0000";

function decimalOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function deriveOutcome(dto: MarketResponseDto): MarketOutcome {
  if (dto.outcome === "YES" || dto.outcome === "NO") return dto.outcome;
  if (dto.status === "RESOLVED_YES") return "YES";
  if (dto.status === "RESOLVED_NO") return "NO";
  return "PENDING";
}

export function normaliseMarket(dto: MarketResponseDto): Market {
  const outcome = deriveOutcome(dto);
  return {
    id: String(dto.id),
    title: dto.title,
    thesis: dto.thesis ?? dto.description ?? "",
    condition: dto.condition ?? "",
    conditionJson: dto.conditionJson ?? null,
    creatorAddress: dto.creatorAddress,
    pairId: dto.pairId ?? null,
    tokenSymbol: dto.tokenSymbol ?? dto.pairId?.split("/")[0] ?? null,
    stakeToken: dto.stakeToken ?? "USDC",
    contractAddress: dto.contractAddress ?? null,
    status: dto.status ?? (outcome === "PENDING" ? "OPEN" : "RESOLVED"),
    outcome,
    resolved: outcome !== "PENDING" || Boolean(dto.resolvedAt),
    endTime: dto.endsAt ?? dto.expiresAt ?? null,
    resolvedAt: dto.resolvedAt ?? null,
    createdAt: dto.createdAt,
    totalYesStroops: amountFromApi(dto.totalYesStake ?? "0"),
    totalNoStroops: amountFromApi(dto.totalNoStake ?? "0"),
    currentPrice: decimalOrNull(dto.currentPrice),
    startPrice: decimalOrNull(dto.startPrice),
    targetPrice: decimalOrNull(
      dto.targetPrice ??
        (dto.conditionJson?.targetPrice as string | number | undefined) ??
        null,
    ),
    isBookmarked: dto.isBookmarked ?? false,
    bookmarkCount: dto.bookmarkCount ?? 0,
  };
}

function normaliseStake(dto: MarketStakeDto): MarketStake {
  const timestamp = dto.createdAt ?? dto.timestamp ?? new Date(0).toISOString();
  const txHash = dto.transactionHash ?? dto.txHash ?? dto.id ?? timestamp;
  return {
    address: dto.userAddress ?? dto.address ?? "",
    side: dto.position ?? dto.side ?? "YES",
    amountStroops: optionalAmountFromApi(dto.amount) ?? 0n,
    timestamp,
    txHash,
    ...(dto.comment ? { comment: dto.comment } : {}),
  };
}

/**
 * Parimutuel odds: a winning side splits the whole pool, so the multiplier for
 * a side is `totalPool / sidePool`. Purely a function of persisted totals, so
 * the same pool always yields the same numbers.
 */
export function deriveOdds(
  totalYesStroops: bigint,
  totalNoStroops: bigint,
): MarketOdds {
  const pool = totalYesStroops + totalNoStroops;
  return {
    yes:
      totalYesStroops > 0n
        ? divideToDecimalString(pool, totalYesStroops, ODDS_DECIMALS)
        : EMPTY_SIDE_ODDS,
    no:
      totalNoStroops > 0n
        ? divideToDecimalString(pool, totalNoStroops, ODDS_DECIMALS)
        : EMPTY_SIDE_ODDS,
    totalPoolStroops: pool,
  };
}

/** `GET /calls/:id` — throws `NotFoundError` when the market does not exist. */
export async function fetchMarket(
  id: string,
  options?: Pick<ApiFetchOptions, "signal">,
): Promise<Market> {
  const dto = await apiFetch<MarketResponseDto>(
    `/calls/${encodeURIComponent(id)}`,
    options,
  );
  return normaliseMarket(dto);
}

/**
 * `GET /calls/:id/stakes` — most recent stakes on the market, newest first.
 * Accepts both a bare array and the paginated `{ data }` envelope.
 */
export async function fetchMarketStakes(
  id: string,
  limit = 50,
  options?: Pick<ApiFetchOptions, "signal">,
): Promise<MarketStake[]> {
  const payload = await apiFetch<MarketStakeDto[] | { data: MarketStakeDto[] }>(
    `/calls/${encodeURIComponent(id)}/stakes`,
    { ...options, query: { limit } },
  );
  const rows = Array.isArray(payload) ? payload : (payload?.data ?? []);
  return rows
    .map(normaliseStake)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}
