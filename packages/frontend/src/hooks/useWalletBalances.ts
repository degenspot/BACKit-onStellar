"use client";

/**
 * Live wallet balances for the configured stake asset.
 *
 * One hook owns the whole question "how much can this wallet actually stake?"
 * so no screen has to invent a balance. It resolves the stake asset for the
 * configured network, reads the connected account from Horizon, and exposes
 * the outcome as a state machine the UI can render one-to-one:
 *
 *   disconnected · config-error · loading · unfunded · no-trustline ·
 *   ready · unavailable
 *
 * Zero balance and insufficient fee balance are properties of a `ready`
 * snapshot rather than separate states, because both still need the rest of
 * the snapshot to be shown usefully.
 *
 * Requests are keyed by `network|address`, so a re-render, a second consumer
 * or a post-stake refresh never fires a duplicate read for data already in
 * flight.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWalletContext } from "@/components/WalletContext";
import { getNetworkConfig, type NetworkConfig } from "@/lib/networkConfig";
import {
  DEFAULT_FEE_BUFFER_STROOPS,
  STALE_AFTER_MS,
  deriveBalanceSnapshot,
  fetchHorizonAccount,
  getStakeAsset,
  isSnapshotStale,
  parseFeeBuffer,
  parseStakeLimits,
  type BalanceSnapshot,
  type StakeAsset,
  type StakeLimits,
} from "@/lib/stellar";

export type WalletBalanceState =
  | { status: "disconnected" }
  /**
   * `scope` says which configuration is broken. `network` is already surfaced
   * (and blocked on) by the network guard, so consumers must not report it a
   * second time; `asset` is this hook's own problem to raise.
   */
  | { status: "config-error"; scope: "network" | "asset"; errors: string[] }
  | { status: "loading" }
  | { status: "unfunded" }
  | { status: "no-trustline"; snapshot: BalanceSnapshot }
  | { status: "ready"; snapshot: BalanceSnapshot }
  | { status: "unavailable"; message: string };

export interface UseWalletBalancesResult {
  state: WalletBalanceState;
  /** Newest snapshot held, if any. Survives a failed refresh. */
  snapshot: BalanceSnapshot | null;
  /** The resolved stake asset, or `null` when configuration is invalid. */
  asset: StakeAsset | null;
  limits: StakeLimits;
  /** The held snapshot is older than {@link STALE_AFTER_MS} or failed to refresh. */
  isStale: boolean;
  /** Why the held snapshot is stale, when a refresh failed. */
  staleReason: string | null;
  isRefreshing: boolean;
  /** Re-read balances. Joins an in-flight read instead of starting a second. */
  refresh: () => Promise<void>;
}

interface Resolution {
  config: NetworkConfig | null;
  asset: StakeAsset | null;
  errors: string[];
  errorScope: "network" | "asset" | null;
  limits: StakeLimits;
  feeBufferStroops: bigint;
}

/** Resolve network + stake-asset configuration once per runtime. */
function resolveConfiguration(): Resolution {
  const limits = parseStakeLimits(process.env);
  const feeBufferStroops = parseFeeBuffer(
    process.env,
    DEFAULT_FEE_BUFFER_STROOPS,
  );
  const configResult = getNetworkConfig();

  if (configResult.status === "error") {
    return {
      config: null,
      asset: null,
      errors: configResult.errors,
      errorScope: "network",
      limits,
      feeBufferStroops,
    };
  }

  const assetResult = getStakeAsset(configResult.config.name);
  if (assetResult.status === "error") {
    return {
      config: configResult.config,
      asset: null,
      errors: assetResult.errors,
      errorScope: "asset",
      limits,
      feeBufferStroops,
    };
  }

  return {
    config: configResult.config,
    asset: assetResult.asset,
    errors: [],
    errorScope: null,
    limits,
    feeBufferStroops,
  };
}

export function useWalletBalances(): UseWalletBalancesResult {
  const { publicKey, isConnected, network } = useWalletContext();

  const resolution = useMemo(resolveConfiguration, []);
  const { config, asset, errors, errorScope, limits, feeBufferStroops } =
    resolution;

  const address = isConnected ? publicKey : null;
  // The wallet-reported network is part of the key so switching networks in
  // the wallet re-reads balances even though we always query the configured
  // deployment's Horizon.
  const requestKey =
    address && config && asset
      ? `${network ?? "?"}|${config.name}|${address}`
      : null;

  const [state, setState] = useState<WalletBalanceState>(() => {
    if (errorScope)
      return { status: "config-error", scope: errorScope, errors };
    if (!address) return { status: "disconnected" };
    return { status: "loading" };
  });
  const [snapshot, setSnapshot] = useState<BalanceSnapshot | null>(null);
  const [staleReason, setStaleReason] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  /** Advanced by a timer when the held snapshot ages past the threshold. */
  const [stalenessClock, setStalenessClock] = useState(() => Date.now());

  const inFlight = useRef<{ key: string; promise: Promise<void> } | null>(null);
  /** Key of the account/network the UI is currently showing. */
  const activeKey = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // `load` is recreated whenever the account or network changes, which is
  // exactly when the previous result stops being valid.
  const load = useCallback((): Promise<void> => {
    if (!requestKey || !config || !asset || !address) return Promise.resolve();

    const existing = inFlight.current;
    if (existing && existing.key === requestKey) return existing.promise;

    activeKey.current = requestKey;
    setIsRefreshing(true);
    const promise = (async () => {
      const result = await fetchHorizonAccount(config.horizonUrl, address);
      // The account or network may have changed while this was in flight;
      // one wallet's balance must never be shown against another's address.
      if (!mounted.current || activeKey.current !== requestKey) return;

      if (result.status === "unavailable") {
        // Keep whatever we already had and mark it stale rather than
        // pretending the account holds nothing.
        setStaleReason(result.message);
        setState((prev) =>
          prev.status === "ready" || prev.status === "no-trustline"
            ? prev
            : { status: "unavailable", message: result.message },
        );
        return;
      }

      if (result.status === "not-found") {
        setSnapshot(null);
        setStaleReason(null);
        setState({ status: "unfunded" });
        return;
      }

      const next = deriveBalanceSnapshot({
        account: result.account,
        asset,
        address,
        fetchedAt: Date.now(),
        feeBufferStroops,
      });
      setSnapshot(next);
      setStaleReason(null);
      setState(
        next.hasTrustline
          ? { status: "ready", snapshot: next }
          : { status: "no-trustline", snapshot: next },
      );
    })()
      .catch((err: unknown) => {
        if (!mounted.current || activeKey.current !== requestKey) return;
        const message =
          err instanceof Error ? err.message : "Could not read wallet balances";
        setStaleReason(message);
        setState((prev) =>
          prev.status === "ready" || prev.status === "no-trustline"
            ? prev
            : { status: "unavailable", message },
        );
      })
      .finally(() => {
        if (inFlight.current?.key === requestKey) inFlight.current = null;
        if (mounted.current && activeKey.current === requestKey) {
          setIsRefreshing(false);
        }
      });

    inFlight.current = { key: requestKey, promise };
    return promise;
  }, [requestKey, config, asset, address, feeBufferStroops]);

  // Wallet or network changed: drop the previous account's data before the
  // new read lands so no stale balance is ever attributed to a new address.
  useEffect(() => {
    if (errorScope) {
      setState({ status: "config-error", scope: errorScope, errors });
      return;
    }
    if (!requestKey) {
      activeKey.current = null;
      setSnapshot(null);
      setStaleReason(null);
      setState({ status: "disconnected" });
      return;
    }
    setSnapshot(null);
    setStaleReason(null);
    setState({ status: "loading" });
    void load();
    // `load` already carries `requestKey`; `errors` is resolved once per runtime.
  }, [requestKey, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render once the held snapshot ages into staleness so the warning
  // appears without polling Horizon.
  useEffect(() => {
    if (!snapshot) return;
    const remaining = snapshot.fetchedAt + STALE_AFTER_MS - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => {
      if (mounted.current) setStalenessClock(Date.now());
    }, remaining);
    return () => clearTimeout(timer);
  }, [snapshot]);

  const isStale =
    staleReason !== null ||
    (snapshot !== null && isSnapshotStale(snapshot, stalenessClock));

  const refresh = useCallback(() => load(), [load]);

  return {
    state,
    snapshot,
    asset,
    limits,
    isStale,
    staleReason,
    isRefreshing,
    refresh,
  };
}
