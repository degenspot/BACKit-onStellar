/**
 * Adapter for the BACKit Soroban gas_station contract (#597).
 * Queries remaining free sponsored transactions and resource fee estimates.
 */

export interface GasStationAllowance {
  /** Max free sponsored txs in the current period */
  maxFree: number;
  /** Remaining free sponsored txs */
  remainingFree: number;
  /** Whether the next tx can be sponsored */
  canSponsor: boolean;
}

export interface ResourceFeeBreakdown {
  cpuInstructions: number;
  memoryBytes: number;
  /** Network fee in stroops (1 XLM = 10_000_000 stroops) */
  feeStroops: number;
  feeXlm: string;
  feeUsdEstimate: string;
}

export interface GasStationQuote {
  allowance: GasStationAllowance;
  resources: ResourceFeeBreakdown;
  sponsored: boolean;
  badgeLabel: string;
}

const DEFAULT_MAX_FREE = 3;
const STROOPS_PER_XLM = 10_000_000;

export function formatStroopsAsXlm(stroops: number): string {
  return (stroops / STROOPS_PER_XLM).toFixed(7).replace(/\.?0+$/, "") || "0";
}

export function buildBadgeLabel(allowance: GasStationAllowance): string {
  if (allowance.remainingFree <= 0) {
    return "Gas Station allowance exhausted — pay network fees";
  }
  return `Sponsored by BackIt Gas Station (${allowance.remainingFree}/${allowance.maxFree} Free Transactions Left)`;
}

/**
 * Fetch remaining sponsored allowance for `account`.
 * Falls back to a conservative default when the API is unavailable.
 */
export async function fetchGasStationAllowance(
  account: string | null | undefined,
  signal?: AbortSignal,
): Promise<GasStationAllowance> {
  if (!account) {
    return {
      maxFree: DEFAULT_MAX_FREE,
      remainingFree: DEFAULT_MAX_FREE,
      canSponsor: true,
    };
  }
  try {
    const res = await fetch(
      `/api/gas-station/allowance?account=${encodeURIComponent(account)}`,
      { signal },
    );
    if (!res.ok) throw new Error(`allowance ${res.status}`);
    const data = (await res.json()) as Partial<GasStationAllowance>;
    const maxFree = Number(data.maxFree ?? DEFAULT_MAX_FREE);
    const remainingFree = Math.max(
      0,
      Math.min(maxFree, Number(data.remainingFree ?? maxFree)),
    );
    return {
      maxFree,
      remainingFree,
      canSponsor: remainingFree > 0,
    };
  } catch {
    return {
      maxFree: DEFAULT_MAX_FREE,
      remainingFree: DEFAULT_MAX_FREE,
      canSponsor: true,
    };
  }
}

export async function estimateResourceFees(
  xdr?: string,
  signal?: AbortSignal,
): Promise<ResourceFeeBreakdown> {
  try {
    if (xdr) {
      const res = await fetch("/api/relay/estimate-fee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xdr }),
        signal,
      });
      if (!res.ok) throw new Error("estimate failed");
      const data = await res.json();
      const feeStroops = Number(
        data.feeStroops ?? data.stroops ?? 100_000,
      );
      return {
        cpuInstructions: Number(data.cpuInstructions ?? data.cpu ?? 0),
        memoryBytes: Number(data.memoryBytes ?? data.memory ?? 0),
        feeStroops,
        feeXlm: data.estimatedGasXLM ?? formatStroopsAsXlm(feeStroops),
        feeUsdEstimate: data.estimatedGasUSD ?? "~$0.00",
      };
    }
  } catch {
    /* fall through to static */
  }
  return {
    cpuInstructions: 2_500_000,
    memoryBytes: 64_000,
    feeStroops: 100_000,
    feeXlm: formatStroopsAsXlm(100_000),
    feeUsdEstimate: "~$0.0001",
  };
}

export async function getGasStationQuote(
  account: string | null | undefined,
  xdr?: string,
  signal?: AbortSignal,
): Promise<GasStationQuote> {
  const [allowance, resources] = await Promise.all([
    fetchGasStationAllowance(account, signal),
    estimateResourceFees(xdr, signal),
  ]);
  const sponsored = allowance.canSponsor;
  return {
    allowance,
    resources,
    sponsored,
    badgeLabel: buildBadgeLabel(allowance),
  };
}

/** Top-up entrypoint for advanced users (opens deposit / pay-fee flow). */
export function getGasStationTopUpPath(): string {
  return "/settings/gas-station";
}
