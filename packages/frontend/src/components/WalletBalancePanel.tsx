"use client";

import { AlertTriangle, Clock, RefreshCw, Wallet } from "lucide-react";
import type { WalletBalanceState } from "@/hooks/useWalletBalances";
import {
  describeStakeAsset,
  formatStakeAmount,
  formatXlmAmount,
  type BalanceSnapshot,
  type StakeAsset,
} from "@/lib/stellar";

interface Props {
  state: WalletBalanceState;
  snapshot: BalanceSnapshot | null;
  asset: StakeAsset | null;
  isStale: boolean;
  staleReason: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  /** Asset code the market says its pool is denominated in. */
  marketStakeToken: string;
  /** The market's asset code does not match the configured stake asset. */
  assetMismatch: boolean;
}

function Shell({
  tone,
  icon,
  children,
}: {
  tone: "neutral" | "warn" | "error";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const palette = {
    neutral: "border-gray-100 bg-gray-50 text-gray-600",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    error: "border-red-200 bg-red-50 text-red-700",
  }[tone];

  return (
    <div
      role="status"
      className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-xs ${palette}`}
    >
      {icon}
      <div className="flex-1 space-y-1">{children}</div>
    </div>
  );
}

function RefreshButton({
  onRefresh,
  isRefreshing,
}: {
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={isRefreshing}
      className="inline-flex items-center gap-1.5 rounded-lg border border-current px-2 py-1 text-[11px] font-bold transition hover:opacity-80 disabled:opacity-50"
    >
      <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
      {isRefreshing ? "Refreshing balance…" : "Refresh balance"}
    </button>
  );
}

/**
 * The wallet-balance surface of the staking screen.
 *
 * Each state a balance read can land in gets its own message and, where the
 * user can do something about it, its own recovery action. A disabled MAX with
 * no explanation is the failure mode this replaces.
 */
export default function WalletBalancePanel({
  state,
  snapshot,
  asset,
  isStale,
  staleReason,
  isRefreshing,
  onRefresh,
  marketStakeToken,
  assetMismatch,
}: Props) {
  const assetLabel = asset ? asset.code : marketStakeToken;

  if (assetMismatch && asset) {
    return (
      <Shell tone="error" icon={<AlertTriangle className="h-4 w-4 shrink-0" />}>
        <p className="font-bold">Unsupported stake asset</p>
        <p>
          This market is denominated in {marketStakeToken}, but BACKit is
          configured for {describeStakeAsset(asset)}. Staking is disabled so
          funds are not sent to the wrong asset.
        </p>
      </Shell>
    );
  }

  switch (state.status) {
    case "disconnected":
      return (
        <Shell tone="neutral" icon={<Wallet className="h-4 w-4 shrink-0" />}>
          <p className="font-bold">Wallet not connected</p>
          <p>Connect a wallet to see your {assetLabel} balance.</p>
        </Shell>
      );

    case "config-error":
      // A broken *network* config is already reported (and blocked on) by the
      // network guard banner; repeating it here would just add noise.
      if (state.scope === "network") return null;
      return (
        <Shell
          tone="error"
          icon={<AlertTriangle className="h-4 w-4 shrink-0" />}
        >
          <p className="font-bold">Stake asset is not configured</p>
          <ul className="list-disc pl-4">
            {state.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Shell>
      );

    case "loading":
      return (
        <Shell tone="neutral">
          <span className="sr-only">Loading wallet balance…</span>
          <span
            aria-hidden="true"
            className="block h-3 w-40 animate-pulse rounded bg-gray-200"
          />
        </Shell>
      );

    case "unfunded":
      return (
        <Shell
          tone="warn"
          icon={<AlertTriangle className="h-4 w-4 shrink-0" />}
        >
          <p className="font-bold">Account not funded</p>
          <p>
            This Stellar account does not exist yet. Send it XLM to create the
            account before staking.
          </p>
          <RefreshButton onRefresh={onRefresh} isRefreshing={isRefreshing} />
        </Shell>
      );

    case "unavailable":
      return (
        <Shell
          tone="warn"
          icon={<AlertTriangle className="h-4 w-4 shrink-0" />}
        >
          <p className="font-bold">Balance unavailable</p>
          <p>{state.message}</p>
          <RefreshButton onRefresh={onRefresh} isRefreshing={isRefreshing} />
        </Shell>
      );

    case "no-trustline":
      return (
        <Shell
          tone="warn"
          icon={<AlertTriangle className="h-4 w-4 shrink-0" />}
        >
          <p className="font-bold">No {assetLabel} trustline</p>
          <p>
            {snapshot?.trustlineUnauthorized
              ? `Your ${assetLabel} trustline has not been authorized by the issuer.`
              : `Add a trustline for ${asset ? describeStakeAsset(asset) : assetLabel} in your wallet before staking.`}
          </p>
          <RefreshButton onRefresh={onRefresh} isRefreshing={isRefreshing} />
        </Shell>
      );

    case "ready": {
      const { snapshot: ready } = state;
      const zeroBalance = ready.spendableStakeStroops <= 0n;
      const tone = zeroBalance || !ready.hasFeeBuffer ? "warn" : "neutral";

      return (
        <Shell tone={tone} icon={<Wallet className="h-4 w-4 shrink-0" />}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="font-bold">
              Available: {formatStakeAmount(ready.spendableStakeStroops)}{" "}
              {assetLabel}
            </span>
            <span className="opacity-70">
              {formatXlmAmount(ready.spendableNativeStroops)} XLM for fees
            </span>
          </div>

          {zeroBalance && (
            <p>
              You have no spendable {assetLabel}. Fund this wallet before
              staking.
            </p>
          )}

          {!ready.hasFeeBuffer && (
            <p>
              Not enough XLM for network fees — keep at least{" "}
              {formatXlmAmount(ready.feeBufferStroops)} XLM available after the
              account reserve of {formatXlmAmount(ready.reservedNativeStroops)}{" "}
              XLM.
            </p>
          )}

          {isStale && (
            <p className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
              {staleReason
                ? `Balance may be out of date — ${staleReason}`
                : "Balance may be out of date."}
            </p>
          )}

          {(isStale || zeroBalance || !ready.hasFeeBuffer) && (
            <RefreshButton onRefresh={onRefresh} isRefreshing={isRefreshing} />
          )}
        </Shell>
      );
    }
  }
}
