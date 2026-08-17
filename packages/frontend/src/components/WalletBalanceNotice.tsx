"use client";

import { AlertTriangle, Info, Loader2, Wallet } from "lucide-react";
import { formatStroops } from "@/lib/stellar/amounts";
import { describeAsset } from "@/lib/stellar/network";
import type {
  StakeLimits,
  StakeValidationReason,
} from "@/lib/stellar/stakeLimits";
import type { WalletBalances } from "@/hooks/useWalletBalances";

interface Props {
  balances: WalletBalances;
  limits: StakeLimits;
  /** Largest submittable stake, already capped by balance and contract rules. */
  maxStakeStroops: bigint;
  reason: StakeValidationReason;
}

type Tone = "info" | "warning" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  info: "border-indigo-100 bg-indigo-50/70 text-indigo-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  neutral: "border-gray-100 bg-gray-50 text-gray-600",
};

/**
 * Renders the one blocking wallet/balance state that matters right now, plus
 * the current balance when everything is in order. Each state has its own
 * message so a user can tell "no trustline" from "no XLM for fees".
 */
export default function WalletBalanceNotice({
  balances,
  limits,
  maxStakeStroops,
  reason,
}: Props) {
  const asset = balances.asset;

  const notice = ((): { tone: Tone; title: string; body: string } | null => {
    if (balances.status === "misconfigured") {
      return {
        tone: "warning",
        title: "Stake asset is not configured",
        body: balances.error ?? "The stake asset has no issuer configured.",
      };
    }
    if (reason === "WALLET_DISCONNECTED") {
      return {
        tone: "neutral",
        title: "Wallet not connected",
        body: "Connect a Stellar wallet to see your balance and stake.",
      };
    }
    if (reason === "MARKET_CLOSED") {
      return {
        tone: "warning",
        title: "Market closed",
        body: "This market is no longer accepting stakes.",
      };
    }
    if (balances.status === "loading") {
      return {
        tone: "neutral",
        title: "Loading balance",
        body: `Reading your ${asset.code} balance from ${balances.network.network.toLowerCase()}.`,
      };
    }
    if (balances.status === "error") {
      return {
        tone: "warning",
        title: "Balance unavailable",
        body: `${balances.error ?? "Horizon did not respond."} Stake amounts stay disabled until the balance is known.`,
      };
    }
    if (reason === "ACCOUNT_NOT_FUNDED") {
      return {
        tone: "warning",
        title: "Account not funded",
        body: "This account does not exist on the network yet. Fund it with XLM before staking.",
      };
    }
    if (reason === "MISSING_TRUSTLINE") {
      return {
        tone: "warning",
        title: `No ${asset.code} trustline`,
        body: `Add a trustline for ${describeAsset(asset)} in your wallet before staking.`,
      };
    }
    if (reason === "INSUFFICIENT_FEE_BALANCE") {
      return {
        tone: "warning",
        title: "Not enough XLM for fees",
        body: `Your spendable XLM (${formatStroops(balances.spendableXlmStroops)}) does not cover the network fee and the account reserve.`,
      };
    }
    if (reason === "ZERO_BALANCE") {
      return {
        tone: "warning",
        title: `No spendable ${asset.code}`,
        body: `This wallet holds ${formatStroops(balances.stakeAssetStroops)} ${asset.code}, which is below what this market accepts.`,
      };
    }
    if (reason === "BELOW_MINIMUM") {
      return {
        tone: "info",
        title: "Below the minimum stake",
        body: `The contract requires at least ${formatStroops(limits.minStroops)} ${asset.code}.`,
      };
    }
    if (reason === "ABOVE_MAXIMUM" && limits.maxStroops !== null) {
      return {
        tone: "info",
        title: "Above the maximum stake",
        body: `The contract caps a single wallet at ${formatStroops(limits.maxStroops)} ${asset.code}.`,
      };
    }
    if (reason === "EXCEEDS_BALANCE") {
      return {
        tone: "info",
        title: "Amount exceeds your balance",
        body: `You can stake up to ${formatStroops(maxStakeStroops)} ${asset.code}.`,
      };
    }
    if (reason === "AMOUNT_NOT_POSITIVE" || reason === "AMOUNT_REQUIRED") {
      return {
        tone: "neutral",
        title: "Enter an amount",
        body: `Stake amounts must be greater than zero, in ${asset.code}.`,
      };
    }
    return null;
  })();

  return (
    <div className="mb-6 space-y-3">
      {balances.status === "ready" && (
        <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3">
          <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gray-400">
            <Wallet className="w-4 h-4" />
            Balance
          </span>
          <span className="text-sm font-black text-gray-900">
            {formatStroops(balances.stakeAssetStroops)} {asset.code}
            <span className="ml-2 text-xs font-medium text-gray-400">
              {formatStroops(balances.spendableXlmStroops)} XLM spendable
            </span>
          </span>
        </div>
      )}

      {balances.isStale && balances.status === "ready" && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Balance may be out of date
          <button
            type="button"
            onClick={() => balances.refresh()}
            className="ml-auto underline"
          >
            Refresh
          </button>
        </p>
      )}

      {notice && (
        <div
          role={notice.tone === "warning" ? "alert" : "status"}
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-xs ${TONE_CLASSES[notice.tone]}`}
        >
          {balances.status === "loading" ? (
            <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />
          ) : notice.tone === "warning" ? (
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          ) : (
            <Info className="w-4 h-4 flex-shrink-0" />
          )}
          <span>
            <span className="font-bold">{notice.title}.</span> {notice.body}
          </span>
        </div>
      )}
    </div>
  );
}
