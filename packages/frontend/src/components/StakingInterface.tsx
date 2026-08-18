"use client";

import { useMemo, useState } from "react";
import PayoutCalculator from "./PayoutCalculator";
import GasFeeDisplay from "./GasFeeDisplay";
import WalletBalanceNotice from "./WalletBalanceNotice";
import { useWalletContext } from "./WalletContext";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import {
  clampInputPrecision,
  formatStroops,
  fromStroops,
  parseAmountInput,
  percentOf,
} from "@/lib/stellar/amounts";
import {
  calculateMaxStakeStroops,
  resolveStakeLimits,
  validateStake,
  type StakeLimits,
} from "@/lib/stellar/stakeLimits";
import type { StakeAsset } from "@/lib/stellar/network";
import {
  describeApiError,
  signTransactionWithWallet,
  submitStake,
  type Market,
  type MarketOdds,
} from "@/lib/backend";

interface Props {
  market: Market;
  odds: MarketOdds | null;
  /** Called after the stake transaction has been submitted successfully. */
  onStaked?: () => void | Promise<void>;
  /** Stake asset for this market, when it differs from the configured default. */
  stakeAsset?: Partial<StakeAsset>;
  /** Contract stake limits, when the market pins its own. */
  stakeLimits?: Partial<StakeLimits>;
}

const PERCENT_PRESETS = [25, 50, 75, 100] as const;
const MAX_COMMENT = 140;

export default function StakingInterface({
  market,
  odds,
  onStaked,
  stakeAsset,
  stakeLimits,
}: Props) {
  const [amount, setAmount] = useState<string>("10");
  const [selectedSide, setSelectedSide] = useState<"YES" | "NO" | null>(null);
  const [isStaking, setIsStaking] = useState(false);
  const [comment, setComment] = useState<string>("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { isConnected, publicKey, wallet, walletType } =
    useWalletContext();

  const walletNetwork =
    wallet.status === "connected" ? wallet.network : null;

  const balances = useWalletBalances(
    publicKey,
    walletNetwork,
    stakeAsset ?? {},
  );

  const limits = useMemo(
    () => resolveStakeLimits(stakeLimits ?? {}),
    [stakeLimits],
  );

  const marketIsActive =
    !market.resolved &&
    (!market.endTime ||
      new Date(market.endTime).getTime() > Date.now());

  const maxStakeStroops = useMemo(
    () =>
      calculateMaxStakeStroops({
        assetBalanceStroops: balances.stakeAssetStroops,
        spendableXlmStroops: balances.spendableXlmStroops,
        stakeAssetIsNative: balances.asset.isNative,
        limits,
      }),
    [
      balances.stakeAssetStroops,
      balances.spendableXlmStroops,
      balances.asset.isNative,
      limits,
    ],
  );

  const amountStroops = parseAmountInput(amount);

  const validation = validateStake({
    amountStroops,
    spendableStakeStroops: maxStakeStroops,
    limits,
    isConnected,
    marketIsActive,
    balanceReady:
      balances.status === "ready" ||
      balances.status === "unfunded",
    accountFunded: balances.status !== "unfunded",
    hasTrustline: balances.hasTrustline,
    hasFeeBalance: balances.spendableXlmStroops > 0n,
  });

  const marketClosed =
    market.resolved ||
    (market.endTime !== null &&
      new Date(market.endTime).getTime() <= Date.now());

  const canSubmit =
    !!selectedSide &&
    amountStroops !== null &&
    validation.canSubmit &&
    isConnected &&
    !marketClosed &&
    !isStaking;

  const applyPercent = (percent: number) => {
    const value =
      percent === 100
        ? maxStakeStroops
        : percentOf(maxStakeStroops, percent);

    setAmount(fromStroops(value));
  };

  const handleStake = async () => {
    if (
      !selectedSide ||
      amountStroops === null ||
      !publicKey ||
      !validation.canSubmit
    ) {
      return;
    }

    setIsStaking(true);
    setError(null);
    setTxHash(null);

    try {
      const result = await submitStake({
        callId: market.id,
        userAddress: publicKey,
        side: selectedSide,
        amountStroops,
        ...(comment ? { comment } : {}),
        signTransaction: (xdr) =>
          signTransactionWithWallet(walletType, xdr),
      });

      setTxHash(result.hash);
      setAmount("10");
      setSelectedSide(null);
      setComment("");

      // Refresh wallet balances after the on-chain transaction.
      await balances.refresh();

      await onStaked?.();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setIsStaking(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm">
      <h3 className="text-xl font-bold text-gray-900 mb-8">
        Place Your Stake
      </h3>

      {/* Side selection */}
      <div className="grid grid-cols-2 gap-4 mb-10">
        <button
          type="button"
          onClick={() => setSelectedSide("YES")}
          disabled={!marketIsActive || isStaking}
          className={`relative group overflow-hidden py-5 rounded-2xl font-bold transition-all duration-300 ${
            selectedSide === "YES"
              ? "bg-green-600 text-white shadow-xl shadow-green-200 scale-[1.02]"
              : "bg-green-50 text-green-700 hover:bg-green-100 border border-green-100"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <div className="relative z-10 flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-80 mb-2">
              Market YES
            </span>

            <span className="text-3xl font-black">
              {odds ? Number(odds.yes).toFixed(2) : "—"}x
            </span>
          </div>

          {selectedSide === "YES" && (
            <div className="absolute inset-0 bg-gradient-to-tr from-green-600 to-emerald-400 opacity-100" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSelectedSide("NO")}
          disabled={!marketIsActive || isStaking}
          className={`relative group overflow-hidden py-5 rounded-2xl font-bold transition-all duration-300 ${
            selectedSide === "NO"
              ? "bg-red-600 text-white shadow-xl shadow-red-200 scale-[1.02]"
              : "bg-red-50 text-red-700 hover:bg-red-100 border border-red-100"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <div className="relative z-10 flex flex-col items-center">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-80 mb-2">
              Market NO
            </span>

            <span className="text-3xl font-black">
              {odds ? Number(odds.no).toFixed(2) : "—"}x
            </span>
          </div>

          {selectedSide === "NO" && (
            <div className="absolute inset-0 bg-gradient-to-tr from-red-600 to-rose-400 opacity-100" />
          )}
        </button>
      </div>

      {/* Wallet balance and blocking states */}
      <WalletBalanceNotice
        balances={balances}
        limits={limits}
        maxStakeStroops={maxStakeStroops}
        reason={validation.reason}
      />

      {/* Amount input */}
      <div className="mb-10">
        <div className="flex justify-between items-end mb-4">
          <label
            htmlFor="stake-amount"
            className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]"
          >
            Stake Amount ({balances.asset.code})
          </label>

          <span className="text-3xl font-black text-gray-900 leading-none">
            {amount || "0"}
          </span>
        </div>

        <input
          id="stake-amount"
          type="text"
          inputMode="decimal"
          value={amount}
          aria-label={`Stake amount in ${balances.asset.code}`}
          onChange={(e) =>
            setAmount(clampInputPrecision(e.target.value.trim()))
          }
          className="w-full mb-6 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-lg font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />

        {/* Percentage presets */}
        <div className="grid grid-cols-4 gap-2">
          {PERCENT_PRESETS.map((pct) => {
            const value =
              pct === 100
                ? maxStakeStroops
                : percentOf(maxStakeStroops, pct);

            const active =
              amountStroops !== null &&
              amountStroops === value;

            return (
              <button
                key={pct}
                type="button"
                onClick={() => applyPercent(pct)}
                disabled={maxStakeStroops <= 0n || isStaking}
                className={`py-2 text-xs font-bold rounded-xl border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-gray-100 text-gray-500 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 bg-white"
                }`}
              >
                {pct === 100 ? "MAX" : `${pct}%`}
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-[11px] text-gray-400">
          Spendable: {formatStroops(maxStakeStroops)}{" "}
          {balances.asset.code}

          {limits.minStroops > 0n && (
            <>
              {" "}
              · Minimum stake{" "}
              {formatStroops(limits.minStroops)}{" "}
              {balances.asset.code}
            </>
          )}
        </p>
      </div>

      {/* Payout Calculator */}
      <div className="mb-10">
        <PayoutCalculator
          yesPoolStroops={market.totalYesStroops}
          noPoolStroops={market.totalNoStroops}
          amountStroops={amountStroops}
          side={selectedSide}
          stakeToken={market.stakeToken}
        />
      </div>

      {/* Optional stake comment */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <label
            htmlFor="stake-comment"
            className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]"
          >
            Add a reason (optional)
          </label>

          <span
            className={`text-xs font-medium ${
              comment.length > MAX_COMMENT - 20
                ? "text-red-500"
                : "text-gray-400"
            }`}
          >
            {MAX_COMMENT - comment.length}
          </span>
        </div>

        <textarea
          id="stake-comment"
          value={comment}
          onChange={(e) =>
            setComment(e.target.value.slice(0, MAX_COMMENT))
          }
          placeholder="Share your thesis for this stake..."
          rows={2}
          className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
        >
          {error}
        </p>
      )}

      {txHash && (
        <p className="mb-4 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 break-all">
          Stake submitted — transaction {txHash}
        </p>
      )}

      {/* Stake button */}
      <button
        type="button"
        onClick={handleStake}
        disabled={!canSubmit}
        className={`w-full py-6 rounded-3xl font-black text-xl shadow-2xl transition-all duration-300 transform active:scale-95 flex items-center justify-center gap-3 ${
          !canSubmit
            ? "bg-gray-100 text-gray-400 cursor-not-allowed shadow-none"
            : selectedSide === "YES"
              ? "bg-green-600 text-white hover:bg-green-700 shadow-green-500/10 hover:shadow-green-500/20"
              : "bg-red-600 text-white hover:bg-red-700 shadow-red-500/10 hover:shadow-red-500/20"
        }`}
      >
        {isStaking ? (
          <>
            <svg
              className="animate-spin h-6 w-6 text-white"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />

              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>

            Processing...
          </>
        ) : (
          `STAKE ON ${selectedSide ?? "…"}`
        )}
      </button>

      {marketClosed && (
        <p className="mt-3 text-xs text-center text-gray-500">
          This market is closed and no longer accepts stakes.
        </p>
      )}

      {!isConnected && !marketClosed && (
        <p className="mt-3 text-xs text-center text-gray-400">
          Connect your wallet to stake
        </p>
      )}

      <div className="mt-4 flex justify-center">
        <GasFeeDisplay />
      </div>

      <p className="mt-3 text-[10px] text-center text-gray-400 font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-2">
        <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
        Soroban Network Smart Contract v1.2.4
      </p>
    </div>
  );
}