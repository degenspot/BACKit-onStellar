"use client";

import { useEffect, useMemo, useState } from "react";
import PayoutCalculator from "./PayoutCalculator";
import GasFeeDisplay from "./GasFeeDisplay";
import NetworkMismatchBanner from "./NetworkMismatchBanner";
import WalletBalancePanel from "./WalletBalancePanel";
import { useWalletContext } from "./WalletContext";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { signTransactionWithWallet } from "@/lib/walletSigning";
import {
  describeApiError,
  submitStake,
  toStroops,
  type Market,
  type MarketOdds,
} from "@/lib/backend";
import {
  computeMaxStakeStroops,
  computePercentStakeStroops,
  formatStakeAmount,
  marketAssetMatches,
  sanitizeAmountInput,
  toAmountInputValue,
  validateStakeAmount,
  type StakeAmountProblem,
} from "@/lib/stellar";

interface Props {
  market: Market;
  odds: MarketOdds | null;
  /** Called after the stake transaction has been submitted successfully. */
  onStaked?: () => void | Promise<void>;
}

const MAX_COMMENT = 140;
const DEFAULT_AMOUNT = "10";
const PERCENT_PRESETS = [25, 50, 75, 100] as const;
/** Fixed quick-picks, offered only while they fit inside the spendable balance. */
const FIXED_PRESETS = ["10", "50", "250", "500"] as const;
/** Keyboard steps across the slider's range. */
const SLIDER_POSITIONS = 100n;

/** Parse the amount field without ever routing money through a float. */
function parseAmount(amount: string): bigint | null {
  try {
    const stroops = toStroops(amount);
    return stroops > 0n ? stroops : null;
  } catch {
    return null;
  }
}

export default function StakingInterface({ market, odds, onStaked }: Props) {
  const [amount, setAmount] = useState<string>(DEFAULT_AMOUNT);
  const [selectedSide, setSelectedSide] = useState<"YES" | "NO" | null>(null);
  const [isStaking, setIsStaking] = useState(false);
  const [comment, setComment] = useState<string>("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    isConnected,
    publicKey,
    walletType,
    network,
    networkStatus,
    requireNetworkMatch,
  } = useWalletContext();

  const {
    state: balanceState,
    snapshot,
    asset,
    limits,
    isStale,
    staleReason,
    isRefreshing,
    refresh,
  } = useWalletBalances();

  const networkMismatch = networkStatus.status !== "match";

  // The market only reports a symbol. If it disagrees with the asset this
  // deployment is configured for, we cannot know which issuer's token would
  // move, so staking stops here rather than at the signature.
  const assetMismatch =
    asset !== null && !marketAssetMatches(market.stakeToken, asset);
  const assetConfigError =
    balanceState.status === "config-error" && balanceState.scope === "asset";
  const assetLabel = asset?.code ?? market.stakeToken;

  /**
   * Spendable stake-asset balance, or `null` when it is genuinely unknown.
   * `null` is not zero: an unreachable Horizon must not disable staking, while
   * an unfunded account or a missing trustline really does mean nothing is
   * available.
   */
  const spendableStroops = useMemo<bigint | null>(() => {
    switch (balanceState.status) {
      case "ready":
        return balanceState.snapshot.spendableStakeStroops;
      case "no-trustline":
      case "unfunded":
        return 0n;
      default:
        return null;
    }
  }, [balanceState]);

  const hasFeeBuffer =
    balanceState.status === "unfunded"
      ? false
      : (snapshot?.hasFeeBuffer ?? true);

  const amountStroops = parseAmount(amount);
  const marketClosed =
    market.resolved ||
    (market.endTime !== null &&
      new Date(market.endTime).getTime() <= Date.now());

  const maxStakeStroops =
    spendableStroops !== null
      ? computeMaxStakeStroops(spendableStroops, limits)
      : null;

  const validation = validateStakeAmount({
    amountStroops,
    spendableStroops,
    limits,
    hasFeeBuffer,
    marketActive: !marketClosed,
  });

  // Shown next to the field, so a closed market — which is about the market,
  // not the number typed — is reported by the submit button instead.
  const amountValidation = validateStakeAmount({
    amountStroops,
    spendableStroops,
    limits,
    hasFeeBuffer,
    marketActive: true,
  });
  const amountProblem: StakeAmountProblem | null =
    amountValidation.status === "error" ? amountValidation.problem : null;

  const canSubmit =
    !!selectedSide &&
    isConnected &&
    !networkMismatch &&
    !assetMismatch &&
    !assetConfigError &&
    !isStaking &&
    validation.status === "ok";

  /** Plain-language reason an amount cannot be submitted. */
  const amountProblemMessage = (problem: StakeAmountProblem): string => {
    switch (problem) {
      case "market-closed":
        return "This market is closed, so it can no longer be staked on.";
      case "invalid-amount":
        return "Enter a stake amount greater than zero.";
      case "below-minimum":
        return `The minimum stake is ${formatStakeAmount(limits.minStroops)} ${assetLabel}.`;
      case "above-maximum":
        return `The maximum stake is ${formatStakeAmount(limits.maxStroops ?? 0n)} ${assetLabel}.`;
      case "exceeds-balance":
        return `You can stake at most ${formatStakeAmount(spendableStroops ?? 0n)} ${assetLabel}.`;
      case "insufficient-fee":
        return "Your wallet does not hold enough XLM to pay the network fee.";
    }
  };

  // A disabled control that does not say why it is disabled leaves the user
  // guessing, and a screen reader announces only "dimmed". The first unmet
  // condition is surfaced, in the order a user would hit them.
  const gateReason = (() => {
    if (isStaking) return "Your stake is being submitted.";
    if (marketClosed)
      return "This market is closed, so it can no longer be staked on.";
    if (!isConnected) return "Connect a wallet to stake.";
    if (networkMismatch)
      return "Switch your wallet to the correct network to stake.";
    if (assetMismatch)
      return `This market is denominated in ${market.stakeToken}, which is not the configured stake asset.`;
    if (assetConfigError)
      return "The stake asset is not configured, so balances cannot be verified.";
    if (balanceState.status === "unfunded")
      return "This Stellar account is not funded yet.";
    if (balanceState.status === "no-trustline")
      return `Add a ${assetLabel} trustline in your wallet to stake.`;
    if (!selectedSide) return "Choose an outcome to stake on.";
    return null;
  })();

  // An amount problem already has a visible message beside the field, so the
  // button points at that rather than repeating the sentence off-screen.
  const submitDescribedBy = gateReason
    ? "stake-submit-reason"
    : amountProblem
      ? "stake-amount-problem"
      : undefined;

  // Clear cached transaction state whenever the account or network changes so
  // a stale hash/error from a previous wallet cannot linger in the view.
  useEffect(() => {
    setTxHash(null);
    setError(null);
    setIsStaking(false);
  }, [publicKey, network]);

  const handleStake = async () => {
    if (!canSubmit || !selectedSide || amountStroops === null || !publicKey)
      return;
    requireNetworkMatch();

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
        signTransaction: (xdr) => signTransactionWithWallet(walletType, xdr),
      });
      setTxHash(result.hash);
      setAmount(DEFAULT_AMOUNT);
      setSelectedSide(null);
      setComment("");
      // The balance moved on-chain, so re-read it. `refresh` joins an
      // in-flight read, so this never duplicates the parent's own reload.
      await Promise.all([refresh(), onStaked?.()]);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setIsStaking(false);
    }
  };

  // Slider bounds follow the spendable balance; with no balance to work from
  // the slider is disabled rather than inviting an unaffordable amount.
  const sliderMaxStroops =
    maxStakeStroops !== null && maxStakeStroops > 0n ? maxStakeStroops : null;
  const sliderDisabled = sliderMaxStroops === null;
  const sliderValueStroops =
    amountStroops !== null && amountStroops > 0n
      ? sliderMaxStroops !== null && amountStroops > sliderMaxStroops
        ? sliderMaxStroops
        : amountStroops
      : 0n;
  const sliderStep = sliderMaxStroops
    ? toAmountInputValue(
        sliderMaxStroops / SLIDER_POSITIONS > 0n
          ? sliderMaxStroops / SLIDER_POSITIONS
          : 1n,
      )
    : "1";

  const percentPresets = PERCENT_PRESETS.map((pct) => {
    const stroops =
      spendableStroops !== null
        ? computePercentStakeStroops(spendableStroops, pct, limits)
        : null;
    const usable = stroops !== null && stroops >= limits.minStroops;
    return {
      pct,
      stroops,
      usable,
      value: stroops !== null ? toAmountInputValue(stroops) : null,
    };
  });

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm">
      <h3 className="text-xl font-bold text-gray-900 mb-8">Place Your Stake</h3>

      <WalletBalancePanel
        state={balanceState}
        snapshot={snapshot}
        asset={asset}
        isStale={isStale}
        staleReason={staleReason}
        isRefreshing={isRefreshing}
        onRefresh={() => void refresh()}
        marketStakeToken={market.stakeToken}
        assetMismatch={assetMismatch}
      />

      {/* Side selection */}
      <div className="grid grid-cols-2 gap-4 mb-10">
        <button
          onClick={() => setSelectedSide("YES")}
          className={`relative group overflow-hidden py-5 rounded-2xl font-bold transition-all duration-300 ${
            selectedSide === "YES"
              ? "bg-green-600 text-white shadow-xl shadow-green-200 scale-[1.02]"
              : "bg-green-50 text-green-700 hover:bg-green-100 border border-green-100"
          }`}
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
          onClick={() => setSelectedSide("NO")}
          className={`relative group overflow-hidden py-5 rounded-2xl font-bold transition-all duration-300 ${
            selectedSide === "NO"
              ? "bg-red-600 text-white shadow-xl shadow-red-200 scale-[1.02]"
              : "bg-red-50 text-red-700 hover:bg-red-100 border border-red-100"
          }`}
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

      {/* Amount input & Slider */}
      <div className="mb-10">
        <div className="flex justify-between items-end mb-4 gap-4">
          <label
            htmlFor="stake-amount"
            className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]"
          >
            Stake Amount ({assetLabel})
          </label>
          {/* Editable so an exact, 7-decimal amount can be entered — the
              slider alone cannot express every stroop. */}
          <input
            id="stake-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))}
            aria-invalid={amountProblem ? true : undefined}
            aria-describedby={
              amountProblem ? "stake-amount-problem" : undefined
            }
            className="w-40 bg-transparent text-right text-3xl font-black text-gray-900 leading-none focus:outline-none focus:ring-2 focus:ring-indigo-300 rounded-lg"
          />
        </div>

        <div className="slider-container relative mb-4 flex items-center h-10">
          <input
            id="stake-amount-slider"
            type="range"
            min="0"
            max={sliderMaxStroops ? toAmountInputValue(sliderMaxStroops) : "0"}
            step={sliderStep}
            value={toAmountInputValue(sliderValueStroops)}
            disabled={sliderDisabled}
            onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))}
            aria-label={`Stake amount in ${assetLabel}`}
            className="w-full h-1.5 bg-gray-100 rounded-full appearance-none cursor-pointer accent-indigo-600 hover:accent-indigo-700 transition-all disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {amountProblem && (
          <p
            id="stake-amount-problem"
            className="mb-4 text-xs font-medium text-red-600"
          >
            {amountProblemMessage(amountProblem)}
          </p>
        )}

        <div className="grid grid-cols-4 gap-3">
          {FIXED_PRESETS.map((v) => {
            const presetStroops = toStroops(v);
            const affordable =
              maxStakeStroops === null || presetStroops <= maxStakeStroops;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(v)}
                disabled={!affordable}
                // Without aria-pressed the selected preset is conveyed only by
                // its indigo fill, which is invisible to anyone not seeing colour.
                aria-pressed={amount === v}
                aria-label={`Stake ${v} ${assetLabel}`}
                title={
                  affordable
                    ? undefined
                    : `More than your spendable ${assetLabel} balance`
                }
                className="py-2.5 text-xs font-bold border border-gray-100 rounded-xl hover:bg-indigo-50 hover:border-indigo-100 hover:text-indigo-600 transition-all text-gray-500 bg-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:border-gray-100 disabled:hover:text-gray-500"
              >
                {v}
              </button>
            );
          })}
        </div>

        {/* Percentage presets, derived from the live spendable balance. */}
        <div className="mt-3 grid grid-cols-4 gap-2">
          {percentPresets.map(({ pct, value, usable }) => {
            const active = value !== null && amount === value;
            const label = pct === 100 ? "MAX" : `${pct}%`;
            return (
              <button
                key={pct}
                type="button"
                onClick={() => value !== null && setAmount(value)}
                disabled={!usable}
                aria-pressed={active}
                aria-label={
                  usable && value !== null
                    ? pct === 100
                      ? `Stake maximum, ${value} ${assetLabel}`
                      : `Stake ${pct} percent, ${value} ${assetLabel}`
                    : `${label} — no spendable ${assetLabel} balance`
                }
                className={`py-2 text-xs font-bold rounded-xl border transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "border-gray-100 text-gray-500 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 bg-white disabled:hover:bg-white disabled:hover:border-gray-100 disabled:hover:text-gray-500"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Payout Calculator */}
      <div className="mb-10">
        <PayoutCalculator
          yesPoolStroops={market.totalYesStroops}
          noPoolStroops={market.totalNoStroops}
          amountStroops={amountStroops}
          side={selectedSide}
          stakeToken={assetLabel}
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
            className={`text-xs font-medium ${comment.length > MAX_COMMENT - 20 ? "text-red-500" : "text-gray-400"}`}
          >
            {MAX_COMMENT - comment.length}
          </span>
        </div>
        <textarea
          id="stake-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
          placeholder="Share your thesis for this stake..."
          rows={2}
          className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      {error && (
        <p
          id="stake-error"
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

      <NetworkMismatchBanner />

      {/* Stake button */}
      {/* Announced via aria-describedby rather than a live region: it is a
          static explanation of the button's state, not a change to report. */}
      {gateReason && (
        <p id="stake-submit-reason" className="sr-only">
          {gateReason}
        </p>
      )}

      <button
        type="button"
        onClick={handleStake}
        disabled={!canSubmit}
        aria-describedby={submitDescribedBy}
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
      {isConnected && networkMismatch && !marketClosed && (
        <p className="mt-3 text-xs text-center text-amber-600">
          Switch your wallet to the configured network to stake
        </p>
      )}

      <div className="mt-4 flex justify-center">
        <GasFeeDisplay />
      </div>
    </div>
  );
}
