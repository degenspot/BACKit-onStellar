"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toStroops } from "@/lib/stellar/amounts";
import {
  findAssetBalance,
  resolveNetworkConfig,
  type HorizonBalanceLine,
  type NetworkConfig,
  type StakeAsset,
} from "@/lib/stellar/network";
import {
  requiredXlmReserveStroops,
  spendableXlmStroops,
} from "@/lib/stellar/stakeLimits";

/** How old balance data may be before it is flagged as stale. */
const STALE_AFTER_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export type WalletBalanceStatus =
  | "disconnected"
  | "loading"
  | "ready"
  | "unfunded"
  | "misconfigured"
  | "error";

export interface WalletBalances {
  status: WalletBalanceStatus;
  /** Native XLM balance. */
  nativeStroops: bigint;
  /** Native XLM minus the protocol reserve — what can be spent on fees. */
  spendableXlmStroops: bigint;
  /** Configured stake-asset balance (equals the native balance for XLM). */
  stakeAssetStroops: bigint;
  /** Whether the account holds a trustline for the configured stake asset. */
  hasTrustline: boolean;
  /** Data is older than the staleness window, or a refresh failed. */
  isStale: boolean;
  /** Timestamp of the last successful load. */
  updatedAt: number | null;
  error: string | null;
  asset: StakeAsset;
  network: NetworkConfig;
  refresh: () => Promise<void>;
}

interface HorizonAccount {
  balances?: HorizonBalanceLine[];
  subentry_count?: number;
  num_sponsoring?: number;
  num_sponsored?: number;
}

interface Snapshot {
  nativeStroops: bigint;
  spendableXlmStroops: bigint;
  stakeAssetStroops: bigint;
  hasTrustline: boolean;
  updatedAt: number;
}

const EMPTY_SNAPSHOT: Omit<Snapshot, "updatedAt"> = {
  nativeStroops: 0n,
  spendableXlmStroops: 0n,
  stakeAssetStroops: 0n,
  hasTrustline: false,
};

function safeToStroops(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return toStroops(value);
  } catch {
    return 0n;
  }
}

/**
 * Load the connected wallet's native and stake-asset balances from Horizon.
 *
 * Reloads when the address or network changes; `refresh()` re-reads after a
 * successful stake. Concurrent loads for the same key are de-duplicated, so a
 * re-render or a double refresh never fires two requests.
 */
export function useWalletBalances(
  address: string | null,
  network: string | null,
  assetOverrides: Partial<StakeAsset> = {},
): WalletBalances {
  const overrideKey = JSON.stringify(assetOverrides);
  const networkConfig = useMemo(
    () => resolveNetworkConfig(network, assetOverrides),
    // assetOverrides is an object literal at most call sites; key on its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network, overrideKey],
  );

  const [status, setStatus] = useState<WalletBalanceStatus>(
    address ? "loading" : "disconnected",
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const inFlight = useRef<{ key: string; promise: Promise<void> } | null>(null);

  const load = useCallback(async () => {
    if (!address) {
      setStatus("disconnected");
      setSnapshot(null);
      setError(null);
      return;
    }
    if (networkConfig.configError) {
      setStatus("misconfigured");
      setError(networkConfig.configError);
      return;
    }

    const key = `${networkConfig.horizonUrl}|${address}|${networkConfig.stakeAsset.code}|${networkConfig.stakeAsset.issuer ?? "native"}`;
    if (inFlight.current?.key === key) {
      await inFlight.current.promise;
      return;
    }

    const run = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(
          `${networkConfig.horizonUrl}/accounts/${encodeURIComponent(address)}`,
          {
            signal: controller.signal,
            headers: { Accept: "application/json" },
          },
        );

        if (res.status === 404) {
          setSnapshot({ ...EMPTY_SNAPSHOT, updatedAt: Date.now() });
          setStatus("unfunded");
          setError(null);
          return;
        }
        if (!res.ok) throw new Error(`Horizon returned ${res.status}`);

        const account = (await res.json()) as HorizonAccount;
        const native = findAssetBalance(account.balances, {
          code: "XLM",
          issuer: null,
          contractId: null,
          isNative: true,
        });
        const stakeLine = findAssetBalance(
          account.balances,
          networkConfig.stakeAsset,
        );

        const nativeStroops = safeToStroops(native?.balance);
        const reserve = requiredXlmReserveStroops({
          subentryCount: account.subentry_count ?? 0,
          numSponsoring: account.num_sponsoring ?? 0,
          numSponsored: account.num_sponsored ?? 0,
        });
        const spendableXlm = spendableXlmStroops(nativeStroops, reserve);

        setSnapshot({
          nativeStroops,
          spendableXlmStroops: spendableXlm,
          stakeAssetStroops: networkConfig.stakeAsset.isNative
            ? spendableXlm
            : safeToStroops(stakeLine?.balance),
          hasTrustline: networkConfig.stakeAsset.isNative
            ? true
            : Boolean(stakeLine),
          updatedAt: Date.now(),
        });
        setStatus("ready");
        setError(null);
      } catch (err) {
        // Keep the last good snapshot and mark it stale rather than showing
        // a balance of zero for a wallet that actually holds funds.
        setStatus((previous) => (previous === "ready" ? "ready" : "error"));
        setError(
          err instanceof Error && err.name === "AbortError"
            ? "Balance request timed out"
            : err instanceof Error
              ? err.message
              : "Could not load balances",
        );
      } finally {
        clearTimeout(timeout);
        inFlight.current = null;
      }
    })();

    inFlight.current = { key, promise: run };
    await run;
  }, [address, networkConfig]);

  useEffect(() => {
    setStatus(address ? "loading" : "disconnected");
    setSnapshot(null);
    load();
  }, [address, load]);

  // Re-evaluate staleness on an interval instead of on every render.
  useEffect(() => {
    if (!snapshot) return;
    const interval = setInterval(() => setNow(Date.now()), STALE_AFTER_MS / 2);
    return () => clearInterval(interval);
  }, [snapshot]);

  const isStale =
    Boolean(error && snapshot) ||
    Boolean(snapshot && now - snapshot.updatedAt > STALE_AFTER_MS);

  return {
    status,
    nativeStroops: snapshot?.nativeStroops ?? 0n,
    spendableXlmStroops: snapshot?.spendableXlmStroops ?? 0n,
    stakeAssetStroops: snapshot?.stakeAssetStroops ?? 0n,
    hasTrustline: snapshot?.hasTrustline ?? false,
    isStale,
    updatedAt: snapshot?.updatedAt ?? null,
    error,
    asset: networkConfig.stakeAsset,
    network: networkConfig,
    refresh: load,
  };
}
