"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Wallet,
  Award,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronUp,
  ChevronDown,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import ActiveAlerts from "./ActiveAlerts";
import { useWalletContext } from "./WalletContext";
import { signTransactionWithWallet } from "@/lib/walletSigning";
import {
  BackendUnavailableError,
  claimPayout,
  describeApiError,
  divideToDecimalString,
  fetchPortfolio,
  formatAmount,
  sumStroops,
  type Portfolio,
  type PortfolioStake,
} from "@/lib/backend";

interface PortfolioDashboardProps {
  /** Wallet whose portfolio is displayed. */
  address: string;
  /** Asset code the stakes are denominated in. */
  stakeToken?: string;
}

type TabType = "active" | "claimable" | "history";
type SortKey = "date" | "call" | "side" | "amount" | "result" | "payout";
type SortOrder = "asc" | "desc";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; portfolio: Portfolio }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export default function PortfolioDashboard({
  address,
  stakeToken = "XLM",
}: PortfolioDashboardProps) {
  const { publicKey, walletType, isConnected } = useWalletContext();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  /** Claims are only offered on the authenticated wallet's own portfolio. */
  const isOwnPortfolio = isConnected && publicKey === address;

  const loadPortfolio = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const portfolio = await fetchPortfolio(address, { signal });
        if (signal?.aborted) return;
        setState({ status: "ready", portfolio });
      } catch (err) {
        if (signal?.aborted) return;
        setState(
          err instanceof BackendUnavailableError
            ? { status: "unavailable", message: describeApiError(err) }
            : { status: "error", message: describeApiError(err) },
        );
      }
    },
    [address],
  );

  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    loadPortfolio(controller.signal);
    return () => controller.abort();
  }, [address, loadPortfolio]);

  const stakes = useMemo(
    () => (state.status === "ready" ? state.portfolio.stakes : []),
    [state],
  );

  const handleClaim = async (stake: PortfolioStake) => {
    if (!isOwnPortfolio || !publicKey) return;
    setClaimingId(stake.id);
    setClaimMessage(null);
    try {
      const result = await claimPayout(stake.callId, publicKey, (xdr) =>
        signTransactionWithWallet(walletType, xdr),
      );
      setClaimMessage({
        type: "success",
        text: `Payout claim submitted — transaction ${result.hash}`,
      });
      // Re-read persisted state; nothing is mutated locally.
      await loadPortfolio();
    } catch (err) {
      setClaimMessage({ type: "error", text: describeApiError(err) });
    } finally {
      setClaimingId(null);
    }
  };

  const activeStakes = stakes.filter((s) => s.status === "ACTIVE");
  const claimableStakes = stakes.filter(
    (s) => s.status === "CLAIMABLE" || s.status === "CLAIM_PENDING",
  );
  const historyStakes = stakes.filter(
    (s) => s.status === "LOST" || s.status === "CLAIMED",
  );
  const resolvedStakes = stakes.filter((s) => s.status !== "ACTIVE");
  const wonStakes = resolvedStakes.filter((s) => s.status !== "LOST");
  const lostStakes = resolvedStakes.filter((s) => s.status === "LOST");

  const totalValueLocked = sumStroops(activeStakes.map((s) => s.amountStroops));
  const totalWon = sumStroops(wonStakes.map((s) => s.profitLossStroops ?? 0n));
  const totalLost = sumStroops(lostStakes.map((s) => s.amountStroops));
  const winRate =
    resolvedStakes.length > 0
      ? ((wonStakes.length / resolvedStakes.length) * 100).toFixed(1)
      : "0.0";

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
  };

  const compareStakes = (a: PortfolioStake, b: PortfolioStake): number => {
    switch (sortKey) {
      case "call":
        return a.call.title
          .toLowerCase()
          .localeCompare(b.call.title.toLowerCase());
      case "side":
        return a.position.localeCompare(b.position);
      case "amount":
        return a.amountStroops === b.amountStroops
          ? 0
          : a.amountStroops < b.amountStroops
            ? -1
            : 1;
      case "result": {
        const aWon = a.status !== "LOST" ? 1 : 0;
        const bWon = b.status !== "LOST" ? 1 : 0;
        return aWon - bWon;
      }
      case "payout": {
        const aPayout = a.payoutStroops ?? 0n;
        const bPayout = b.payoutStroops ?? 0n;
        return aPayout === bPayout ? 0 : aPayout < bPayout ? -1 : 1;
      }
      case "date":
      default:
        return (
          new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        );
    }
  };

  const sortedHistory = [...historyStakes].sort(
    (a, b) => (sortOrder === "asc" ? 1 : -1) * compareStakes(a, b),
  );

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  /** Live parimutuel multiplier for an open position. */
  const getOddsMultiplier = (item: PortfolioStake) => {
    const total = item.call.totalYesStroops + item.call.totalNoStroops;
    const pool =
      item.position === "YES"
        ? item.call.totalYesStroops
        : item.call.totalNoStroops;
    if (pool <= 0n || total <= 0n) return "—";
    return `${divideToDecimalString(total, pool, 2)}x`;
  };

  const getCountdown = (expiresAt?: string | null) => {
    if (!expiresAt) return "N/A";
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Ended";
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h left`;
  };

  if (state.status === "loading") {
    return (
      <div
        className="flex flex-col items-center justify-center py-20"
        role="status"
      >
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
        <p className="text-gray-500 font-medium animate-pulse">
          Loading portfolio dashboard...
        </p>
      </div>
    );
  }

  if (state.status === "unavailable" || state.status === "error") {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 text-center"
        role="alert"
      >
        <AlertTriangle className="w-10 h-10 text-amber-500 mb-3" />
        <p className="font-bold text-gray-800">
          {state.status === "unavailable"
            ? "Backend unavailable"
            : "Could not load portfolio"}
        </p>
        <p className="text-sm text-gray-500 mt-1 max-w-md">{state.message}</p>
        <button
          onClick={() => loadPortfolio()}
          className="mt-4 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {state.portfolio.payoutsUnavailable && (
        <div
          className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 flex items-center gap-3"
          role="status"
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-semibold">
            Payout history is temporarily unavailable, so claimed positions may
            still appear as claimable.
          </span>
        </div>
      )}

      {/* Summary Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* TVL */}
        <div className="bg-gradient-to-br from-indigo-50/50 to-indigo-100/30 border border-indigo-100/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-500">
              Value Locked
            </span>
            <div className="p-2 bg-indigo-100/80 text-indigo-700 rounded-xl">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-gray-900 leading-tight">
              {formatAmount(totalValueLocked)}
              <span className="text-sm font-bold text-gray-400 ml-1.5 font-mono">
                {stakeToken}
              </span>
            </h3>
            <p className="text-xs text-gray-400 font-medium mt-1">
              Stakes in active prediction pools
            </p>
          </div>
        </div>

        {/* Won */}
        <div className="bg-gradient-to-br from-emerald-50/50 to-emerald-100/30 border border-emerald-100/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-500">
              Total Profit
            </span>
            <div className="p-2 bg-emerald-100/80 text-emerald-700 rounded-xl">
              <Award className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-emerald-700 leading-tight">
              +{formatAmount(totalWon)}
              <span className="text-sm font-bold text-emerald-500/70 ml-1.5 font-mono">
                {stakeToken}
              </span>
            </h3>
            <p className="text-xs text-gray-400 font-medium mt-1">
              Realized earnings from won stakes
            </p>
          </div>
        </div>

        {/* Lost */}
        <div className="bg-gradient-to-br from-rose-50/50 to-rose-100/30 border border-rose-100/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-500">
              Total Lost
            </span>
            <div className="p-2 bg-rose-100/80 text-rose-700 rounded-xl">
              <XCircle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-rose-700 leading-tight">
              -{formatAmount(totalLost)}
              <span className="text-sm font-bold text-rose-500/70 ml-1.5 font-mono">
                {stakeToken}
              </span>
            </h3>
            <p className="text-xs text-gray-400 font-medium mt-1">
              Stakes lost in resolved markets
            </p>
          </div>
        </div>

        {/* Win Rate */}
        <div className="bg-gradient-to-br from-purple-50/50 to-purple-100/30 border border-purple-100/80 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-500">
              Win Rate
            </span>
            <div className="p-2 bg-purple-100/80 text-purple-700 rounded-xl">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-black text-gray-900 leading-tight">
              {winRate}
              <span className="text-lg font-bold text-gray-500 ml-0.5">%</span>
            </h3>
            <p className="text-xs text-gray-400 font-medium mt-1">
              Ratio of correctly predicted calls
            </p>
          </div>
        </div>
      </div>

      {/* Claim message notification */}
      {claimMessage && (
        <div
          role={claimMessage.type === "error" ? "alert" : "status"}
          className={`p-4 rounded-xl border flex items-center gap-3 transition-all duration-300 ${
            claimMessage.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          {claimMessage.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 flex-shrink-0" />
          )}
          <span className="font-semibold text-sm break-all">
            {claimMessage.text}
          </span>
          <button
            onClick={() => setClaimMessage(null)}
            className="ml-auto text-xs font-bold hover:underline opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      {stakes.length === 0 && (
        <div className="text-center py-12 border border-dashed border-gray-200 rounded-2xl">
          <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-bold">
            This wallet has no stakes yet
          </p>
          <p className="text-gray-400 text-sm mt-1">
            Positions appear here as soon as a stake is indexed.
          </p>
          <Link
            href="/feed"
            className="inline-block mt-4 text-sm font-bold text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            Browse active markets &rarr;
          </Link>
        </div>
      )}

      {/* Main Tabs Container */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Navigation Bar */}
        <div className="flex border-b border-gray-100 bg-gray-50/50 p-2 gap-1">
          <button
            onClick={() => setActiveTab("active")}
            className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 ${
              activeTab === "active"
                ? "bg-white text-indigo-700 shadow-sm border border-gray-100/85"
                : "text-gray-500 hover:text-gray-800 hover:bg-gray-100/50"
            }`}
          >
            <span>Active Stakes</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs ${
                activeTab === "active"
                  ? "bg-indigo-100 text-indigo-800"
                  : "bg-gray-200/80 text-gray-600"
              }`}
            >
              {activeStakes.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("claimable")}
            className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 ${
              activeTab === "claimable"
                ? "bg-white text-indigo-700 shadow-sm border border-gray-100/85"
                : "text-gray-500 hover:text-gray-800 hover:bg-gray-100/50"
            }`}
          >
            <span>Claimable Payouts</span>
            {claimableStakes.length > 0 && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            )}
            <span
              className={`px-2 py-0.5 rounded-full text-xs ${
                activeTab === "claimable"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-gray-200/80 text-gray-600"
              }`}
            >
              {claimableStakes.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("history")}
            className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all duration-200 flex items-center justify-center gap-2 ${
              activeTab === "history"
                ? "bg-white text-indigo-700 shadow-sm border border-gray-100/85"
                : "text-gray-500 hover:text-gray-800 hover:bg-gray-100/50"
            }`}
          >
            <span>Staking History</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs ${
                activeTab === "history"
                  ? "bg-indigo-100 text-indigo-800"
                  : "bg-gray-200/80 text-gray-600"
              }`}
            >
              {historyStakes.length}
            </span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-6">
          {/* Active Stakes List */}
          {activeTab === "active" && (
            <div>
              {activeStakes.length === 0 ? (
                <div className="text-center py-12">
                  <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-bold">
                    No Active Stakes found
                  </p>
                  <p className="text-gray-400 text-sm mt-1">
                    Predict on open calls to secure your positions.
                  </p>
                  <Link
                    href="/feed"
                    className="inline-block mt-4 text-sm font-bold text-indigo-600 hover:text-indigo-700 hover:underline"
                  >
                    Browse active markets &rarr;
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {activeStakes.map((stake) => (
                    <div
                      key={stake.id}
                      className="border border-gray-100 rounded-2xl p-5 bg-white shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group"
                    >
                      <div className="absolute top-0 left-0 w-2 h-full bg-indigo-500" />

                      <div className="flex justify-between items-start mb-3">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                          Market Prediction
                        </span>
                        <div className="flex gap-2 items-center">
                          <span className="text-[10px] font-bold text-gray-400 uppercase">
                            Ends In
                          </span>
                          <span className="text-xs font-mono font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-100">
                            {getCountdown(stake.call.expiresAt)}
                          </span>
                        </div>
                      </div>

                      <h4 className="font-bold text-gray-800 text-base leading-snug mb-4 group-hover:text-indigo-600 transition-colors">
                        <Link href={`/calls/${stake.callId}`}>
                          {stake.call.title}
                        </Link>
                      </h4>

                      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-gray-50 bg-gray-50/30 rounded-xl p-3">
                        <div>
                          <span className="block text-[10px] font-bold text-gray-400 uppercase mb-0.5">
                            Position
                          </span>
                          <span
                            className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-black ${
                              stake.position === "YES"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                : "bg-rose-50 text-rose-700 border border-rose-100"
                            }`}
                          >
                            {stake.position === "YES" ? (
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowDownLeft className="w-3.5 h-3.5" />
                            )}
                            {stake.position === "YES" ? "UP" : "DOWN"}
                          </span>
                        </div>

                        <div>
                          <span className="block text-[10px] font-bold text-gray-400 uppercase mb-0.5">
                            Amount
                          </span>
                          <span className="font-bold text-gray-800 text-sm font-mono">
                            {formatAmount(stake.amountStroops)}{" "}
                            <span className="text-[10px] font-normal text-gray-400">
                              {stakeToken}
                            </span>
                          </span>
                        </div>

                        <div>
                          <span className="block text-[10px] font-bold text-gray-400 uppercase mb-0.5">
                            Current Odds
                          </span>
                          <span className="font-bold text-indigo-700 text-sm font-mono">
                            {getOddsMultiplier(stake)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Claimable Payouts List */}
          {activeTab === "claimable" && (
            <div>
              {claimableStakes.length === 0 ? (
                <div className="text-center py-12">
                  <Award className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-bold">
                    No Claimable Payouts available
                  </p>
                  <p className="text-gray-400 text-sm mt-1">
                    Your won predictions will highlight here for you to claim
                    your earnings.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {claimableStakes.map((stake) => (
                    <div
                      key={stake.id}
                      className="border border-emerald-100 rounded-2xl p-5 bg-emerald-50/10 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 w-2 h-full bg-emerald-500" />

                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                            WON
                          </span>
                          <span className="text-xs font-semibold text-gray-400">
                            Resolved on{" "}
                            {formatDate(
                              stake.call.resolvedAt ?? stake.call.expiresAt,
                            )}
                          </span>
                          {stake.status === "CLAIM_PENDING" && (
                            <span className="text-xs font-bold text-amber-600">
                              Claim submitted — awaiting confirmation
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-gray-900 text-base leading-snug">
                          <Link
                            href={`/calls/${stake.callId}`}
                            className="hover:text-indigo-600 transition-colors"
                          >
                            {stake.call.title}
                          </Link>
                        </h4>
                        <div className="flex gap-6 text-sm">
                          <div>
                            <span className="text-xs text-gray-400 font-semibold mr-1.5">
                              Staked:
                            </span>
                            <span className="font-bold text-gray-800 font-mono">
                              {formatAmount(stake.amountStroops)} {stakeToken}
                            </span>
                          </div>
                          <div>
                            <span className="text-xs text-gray-400 font-semibold mr-1.5">
                              Est. Payout:
                            </span>
                            <span className="font-black text-emerald-600 font-mono">
                              {formatAmount(stake.payoutStroops ?? 0n)}{" "}
                              {stakeToken}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="w-full md:w-auto">
                        <button
                          onClick={() => handleClaim(stake)}
                          disabled={claimingId === stake.id || !isOwnPortfolio}
                          className="w-full md:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white font-black text-sm shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                        >
                          {claimingId === stake.id ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Claiming...</span>
                            </>
                          ) : (
                            <>
                              <span>Claim Payout</span>
                              <span>&rarr;</span>
                            </>
                          )}
                        </button>
                        {!isOwnPortfolio && (
                          <p className="mt-2 text-[11px] text-gray-400 text-center md:text-right">
                            Connect this wallet to claim
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Staking History View */}
          {activeTab === "history" && (
            <div>
              {sortedHistory.length === 0 ? (
                <div className="text-center py-12">
                  <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-bold">
                    Staking History is empty
                  </p>
                  <p className="text-gray-400 text-sm mt-1">
                    Completed positions and claimed payouts will appear here.
                  </p>
                </div>
              ) : (
                <>
                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-gray-100 text-xs font-bold text-gray-400 uppercase bg-gray-50/50">
                          {(
                            [
                              ["date", "Date"],
                              ["call", "Call"],
                              ["side", "Side"],
                              ["amount", "Amount"],
                              ["result", "Result"],
                              ["payout", "Payout"],
                            ] as [SortKey, string][]
                          ).map(([key, label]) => (
                            <th
                              key={key}
                              className="py-3 px-4 cursor-pointer hover:bg-gray-100 hover:text-gray-700 transition-colors"
                              onClick={() => handleSort(key)}
                            >
                              <div className="flex items-center gap-1">
                                <span>{label}</span>
                                {sortKey === key &&
                                  (sortOrder === "asc" ? (
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  ))}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-sm">
                        {sortedHistory.map((item) => {
                          const won = item.status !== "LOST";
                          return (
                            <tr
                              key={item.id}
                              className="hover:bg-gray-50/50 transition-colors"
                            >
                              <td className="py-4 px-4 font-medium text-gray-500 font-mono text-xs">
                                {formatDate(item.updatedAt)}
                              </td>
                              <td className="py-4 px-4 font-bold text-gray-900 max-w-xs truncate">
                                <Link
                                  href={`/calls/${item.callId}`}
                                  className="hover:text-indigo-600 transition-colors"
                                >
                                  {item.call.title}
                                </Link>
                              </td>
                              <td className="py-4 px-4">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-black ${
                                    item.position === "YES"
                                      ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                      : "bg-rose-50 text-rose-700 border border-rose-100"
                                  }`}
                                >
                                  {item.position === "YES" ? "UP" : "DOWN"}
                                </span>
                              </td>
                              <td className="py-4 px-4 font-mono font-bold text-gray-800">
                                {formatAmount(item.amountStroops)} {stakeToken}
                              </td>
                              <td className="py-4 px-4">
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                    won
                                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                      : "bg-rose-50 text-rose-700 border border-rose-200"
                                  }`}
                                >
                                  {won ? (
                                    <CheckCircle2 className="w-3 h-3" />
                                  ) : (
                                    <XCircle className="w-3 h-3" />
                                  )}
                                  {won ? "Claimed" : "Lost"}
                                </span>
                              </td>
                              <td
                                className={`py-4 px-4 font-mono font-bold ${won ? "text-emerald-600" : "text-rose-500"}`}
                              >
                                {won
                                  ? `+${formatAmount(item.payoutStroops ?? 0n)}`
                                  : `-${formatAmount(item.amountStroops)}`}{" "}
                                {stakeToken}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards View */}
                  <div className="md:hidden space-y-4">
                    {sortedHistory.map((item) => {
                      const won = item.status !== "LOST";
                      return (
                        <div
                          key={item.id}
                          className="border border-gray-100 rounded-2xl p-4 bg-white shadow-sm flex flex-col gap-3 relative overflow-hidden"
                        >
                          <div
                            className={`absolute top-0 left-0 w-1.5 h-full ${won ? "bg-emerald-500" : "bg-rose-500"}`}
                          />

                          <div className="flex justify-between items-center text-xs font-mono text-gray-400">
                            <span>{formatDate(item.updatedAt)}</span>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${
                                won
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-rose-50 text-rose-700 border border-rose-200"
                              }`}
                            >
                              {won ? "Claimed" : "Lost"}
                            </span>
                          </div>

                          <h5 className="font-bold text-gray-900 text-sm leading-snug">
                            <Link href={`/calls/${item.callId}`}>
                              {item.call.title}
                            </Link>
                          </h5>

                          <div className="flex justify-between items-center bg-gray-50/50 rounded-xl p-2.5 text-xs">
                            <div>
                              <span className="text-gray-400 block mb-0.5 uppercase tracking-widest text-[9px] font-bold">
                                Side
                              </span>
                              <span
                                className={`font-black uppercase ${item.position === "YES" ? "text-emerald-700" : "text-rose-700"}`}
                              >
                                {item.position === "YES" ? "UP" : "DOWN"}
                              </span>
                            </div>

                            <div>
                              <span className="text-gray-400 block mb-0.5 uppercase tracking-widest text-[9px] font-bold">
                                Amount
                              </span>
                              <span className="font-bold text-gray-800 font-mono">
                                {formatAmount(item.amountStroops)} {stakeToken}
                              </span>
                            </div>

                            <div className="text-right">
                              <span className="text-gray-400 block mb-0.5 uppercase tracking-widest text-[9px] font-bold">
                                Payout
                              </span>
                              <span
                                className={`font-mono font-black ${won ? "text-emerald-600" : "text-rose-500"}`}
                              >
                                {won
                                  ? `+${formatAmount(item.payoutStroops ?? 0n)}`
                                  : `-${formatAmount(item.amountStroops)}`}{" "}
                                {stakeToken}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <ActiveAlerts walletAddress={address} />
    </div>
  );
}
