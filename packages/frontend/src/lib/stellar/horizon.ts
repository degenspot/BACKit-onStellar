/**
 * Horizon account reads.
 *
 * Balances are the one input the staking screen cannot guess at, so the three
 * outcomes a caller has to render differently are modelled explicitly instead
 * of collapsing into a thrown error:
 *
 *   - `ok`          → the account exists and its balances were returned
 *   - `not-found`   → the account has never been funded (Horizon answers 404)
 *   - `unavailable` → Horizon did not answer (offline, timeout, 5xx)
 *
 * An `unavailable` result must never be treated as "zero balance": that is the
 * difference between showing a stale-data warning and silently offering a MAX
 * of nothing.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

/** A single balance line as returned by `GET /accounts/:id`. */
export interface HorizonBalanceLine {
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  buying_liabilities?: string;
  selling_liabilities?: string;
  limit?: string;
  is_authorized?: boolean;
  is_authorized_to_maintain_liabilities?: boolean;
}

export interface HorizonAccount {
  id: string;
  sequence: string;
  /** Trustlines, offers, data entries and signers beyond the master key. */
  subentry_count: number;
  num_sponsoring?: number;
  num_sponsored?: number;
  balances: HorizonBalanceLine[];
}

export type HorizonAccountResult =
  | { status: "ok"; account: HorizonAccount }
  | { status: "not-found" }
  | { status: "unavailable"; message: string };

export interface FetchHorizonAccountOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function isHorizonAccount(value: unknown): value is HorizonAccount {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as HorizonAccount).balances)
  );
}

/**
 * Read an account from Horizon.
 *
 * A caller-initiated abort re-throws so `useEffect` cleanup does not land as a
 * user-visible "Horizon unavailable".
 */
export async function fetchHorizonAccount(
  horizonUrl: string,
  address: string,
  options: FetchHorizonAccountOptions = {},
): Promise<HorizonAccountResult> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  const url = `${horizonUrl.replace(/\/$/, "")}/accounts/${encodeURIComponent(address)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    return {
      status: "unavailable",
      message: `Could not reach Horizon at ${horizonUrl}`,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }

  if (res.status === 404) return { status: "not-found" };

  if (!res.ok) {
    return {
      status: "unavailable",
      message: `Horizon returned ${res.status} for ${address}`,
    };
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    return {
      status: "unavailable",
      message: "Horizon returned a malformed response",
    };
  }

  if (!isHorizonAccount(payload)) {
    return {
      status: "unavailable",
      message: "Horizon returned a malformed account",
    };
  }

  return { status: "ok", account: payload };
}
