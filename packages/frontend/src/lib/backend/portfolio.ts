/**
 * Portfolio client.
 *
 * Combines the two existing backend endpoints that describe a wallet's
 * positions:
 *   - `GET /users/:address/stakes`  — the stake ledger joined with its call
 *   - `GET /users/:address/payouts` — persisted payout claims (claimed/failed)
 *
 * The merge is what turns a stake into one of the four portfolio states the
 * UI renders: active, resolved-lost, claimable, or claimed.
 */

import { apiFetch, type ApiFetchOptions } from "./http";
import { amountFromApi, optionalAmountFromApi } from "./amounts";

export type StakePosition = "YES" | "NO";
export type CallOutcome = "YES" | "NO" | "PENDING";

export type PortfolioStakeStatus =
  | "ACTIVE"
  | "LOST"
  | "CLAIMABLE"
  | "CLAIM_PENDING"
  | "CLAIMED";

/** Raw shape of `GET /users/:address/stakes` (analytics `UserStakesResponseDto`). */
export interface UserStakeDto {
  id: string;
  callId: string;
  userAddress: string;
  amount: string | number;
  position: StakePosition;
  profitLoss?: string | number | null;
  transactionHash?: string | null;
  createdAt: string;
  updatedAt: string;
  resolutionStatus: "PENDING" | "RESOLVED";
  call?: {
    id: string;
    title: string;
    description: string;
    outcome: CallOutcome;
    resolvedAt?: string | null;
    expiresAt?: string | null;
    createdAt: string;
    contractAddress?: string | null;
    totalYesStake: string | number;
    totalNoStake: string | number;
  } | null;
}

export interface UserStakesResponseDto {
  data: UserStakeDto[];
  total: number;
  page: number;
  limit: number;
}

/** Raw shape of `GET /users/:address/payouts` (`PayoutClaim` entity). */
export interface PayoutClaimDto {
  id: string;
  callId: string;
  stakerAddress: string;
  amount: string | number;
  txHash?: string | null;
  claimedAt?: string | null;
  status: "PENDING" | "CLAIMED" | "FAILED";
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioStake {
  id: string;
  callId: string;
  userAddress: string;
  position: StakePosition;
  amountStroops: bigint;
  profitLossStroops: bigint | null;
  /** What the wallet receives if this position is claimed (stake + winnings). */
  payoutStroops: bigint | null;
  transactionHash: string | null;
  createdAt: string;
  updatedAt: string;
  status: PortfolioStakeStatus;
  claimTxHash: string | null;
  claimedAt: string | null;
  call: {
    id: string;
    title: string;
    description: string;
    outcome: CallOutcome;
    resolvedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
    contractAddress: string | null;
    totalYesStroops: bigint;
    totalNoStroops: bigint;
  };
}

export interface Portfolio {
  stakes: PortfolioStake[];
  total: number;
  page: number;
  limit: number;
  /**
   * True when the payout ledger could not be read. Claim state then falls back
   * to "claimable", and the UI warns instead of silently showing a wrong state.
   */
  payoutsUnavailable: boolean;
}

/**
 * Parimutuel payout for a winning stake:
 * `stake * totalPool / winningSidePool`, truncated to a stroop.
 */
export function calculatePayoutStroops(
  stakeStroops: bigint,
  winningSideStroops: bigint,
  losingSideStroops: bigint,
): bigint {
  if (winningSideStroops <= 0n) return stakeStroops;
  const pool = winningSideStroops + losingSideStroops;
  return (stakeStroops * pool) / winningSideStroops;
}

function normaliseStake(
  dto: UserStakeDto,
  claim: PayoutClaimDto | undefined,
  payoutsUnavailable: boolean,
): PortfolioStake {
  const call = dto.call;
  const outcome: CallOutcome = call?.outcome ?? "PENDING";
  const amountStroops = amountFromApi(dto.amount);
  const totalYesStroops = amountFromApi(call?.totalYesStake ?? "0");
  const totalNoStroops = amountFromApi(call?.totalNoStake ?? "0");

  const resolved = dto.resolutionStatus === "RESOLVED" && outcome !== "PENDING";
  const won = resolved && outcome === dto.position;

  let status: PortfolioStakeStatus;
  if (!resolved) {
    status = "ACTIVE";
  } else if (!won) {
    status = "LOST";
  } else if (!payoutsUnavailable && claim?.status === "CLAIMED") {
    status = "CLAIMED";
  } else if (
    !payoutsUnavailable &&
    claim?.status === "PENDING" &&
    claim.txHash
  ) {
    status = "CLAIM_PENDING";
  } else {
    status = "CLAIMABLE";
  }

  const claimAmount = claim ? optionalAmountFromApi(claim.amount) : null;
  const payoutStroops = won
    ? claimAmount && claimAmount > 0n
      ? claimAmount
      : calculatePayoutStroops(
          amountStroops,
          dto.position === "YES" ? totalYesStroops : totalNoStroops,
          dto.position === "YES" ? totalNoStroops : totalYesStroops,
        )
    : null;

  return {
    id: dto.id,
    callId: dto.callId,
    userAddress: dto.userAddress,
    position: dto.position,
    amountStroops,
    profitLossStroops: optionalAmountFromApi(dto.profitLoss),
    payoutStroops,
    transactionHash: dto.transactionHash ?? null,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    status,
    claimTxHash: claim?.txHash ?? null,
    claimedAt: claim?.claimedAt ?? null,
    call: {
      id: call?.id ?? dto.callId,
      title: call?.title ?? "Unknown market",
      description: call?.description ?? "",
      outcome,
      resolvedAt: call?.resolvedAt ?? null,
      expiresAt: call?.expiresAt ?? null,
      createdAt: call?.createdAt ?? dto.createdAt,
      contractAddress: call?.contractAddress ?? null,
      totalYesStroops,
      totalNoStroops,
    },
  };
}

/**
 * Load the portfolio for a single wallet.
 *
 * The payout ledger is optional: when it is unreachable the stakes still
 * render, flagged through {@link Portfolio.payoutsUnavailable}.
 */
export async function fetchPortfolio(
  address: string,
  {
    page = 1,
    limit = 50,
    signal,
  }: { page?: number; limit?: number } & Pick<ApiFetchOptions, "signal"> = {},
): Promise<Portfolio> {
  const encoded = encodeURIComponent(address);

  const stakesPromise = apiFetch<UserStakesResponseDto>(
    `/users/${encoded}/stakes`,
    { query: { page, limit }, signal },
  );
  const payoutsPromise = apiFetch<PayoutClaimDto[]>(
    `/users/${encoded}/payouts`,
    {
      signal,
    },
  ).then(
    (rows) => ({ rows, unavailable: false }),
    () => ({ rows: [] as PayoutClaimDto[], unavailable: true }),
  );

  const [stakesResponse, payouts] = await Promise.all([
    stakesPromise,
    payoutsPromise,
  ]);

  const claimsByCallId = new Map<string, PayoutClaimDto>();
  for (const claim of payouts.rows) {
    claimsByCallId.set(claim.callId, claim);
  }

  return {
    stakes: (stakesResponse?.data ?? []).map((stake) =>
      normaliseStake(
        stake,
        claimsByCallId.get(stake.callId),
        payouts.unavailable,
      ),
    ),
    total: stakesResponse?.total ?? 0,
    page: stakesResponse?.page ?? page,
    limit: stakesResponse?.limit ?? limit,
    payoutsUnavailable: payouts.unavailable,
  };
}
