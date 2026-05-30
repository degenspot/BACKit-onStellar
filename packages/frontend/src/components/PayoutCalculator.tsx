"use client";

import { useEffect, useState } from "react";

interface Odds {
  yes: number;
  no: number;
  totalPool: number;
}

interface Props {
  callId: number | string;
  amount: number;
  side: "YES" | "NO" | null;
}

const PLATFORM_FEE = 0.01; // 1%

// Recalculate multiplier accounting for the user's stake changing the pool.
function calcMultiplier(
  odds: Odds,
  side: "YES" | "NO",
  stakeAmount: number
): number {
  if (stakeAmount <= 0) return side === "YES" ? odds.yes : odds.no;

  // Simple AMM-style adjustment: new multiplier = totalPool / (side pool + stake)
  // We approximate the side pool from the base multiplier and total pool.
  const baseMultiplier = side === "YES" ? odds.yes : odds.no;
  const sidePool = odds.totalPool / baseMultiplier;
  const newMultiplier = (odds.totalPool + stakeAmount) / (sidePool + stakeAmount);
  return Math.max(1.01, newMultiplier);
}

export default function PayoutCalculator({ callId, amount, side }: Props) {
  const [odds, setOdds] = useState<Odds | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!callId) return;
    setLoading(true);
    fetch(`/api/calls/${callId}/odds`)
      .then((r) => r.json())
      .then(setOdds)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [callId]);

  if (!side || amount <= 0) return null;

  const multiplier = odds ? calcMultiplier(odds, side, amount) : (side === "YES" ? 2.0 : 2.0);
  const grossPayout = amount * multiplier;
  const fee = grossPayout * PLATFORM_FEE;
  const netPayout = grossPayout - fee;
  const profit = netPayout - amount;
  const isProfit = profit > 0;

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5 space-y-3 text-sm">
      {loading && (
        <p className="text-[10px] text-indigo-400 uppercase tracking-widest font-bold animate-pulse">
          Fetching live odds…
        </p>
      )}

      {/* Main sentence */}
      <p className="text-gray-700 font-medium leading-snug">
        If you stake{" "}
        <span className="font-black text-gray-900">{amount} USDC</span> on{" "}
        <span
          className={`font-black ${side === "YES" ? "text-green-600" : "text-red-600"}`}
        >
          {side}
        </span>
        , your potential payout is{" "}
        <span className="font-black text-indigo-700">
          {grossPayout.toFixed(2)} USDC ({multiplier.toFixed(2)}x)
        </span>
        .
      </p>

      {/* Fee row */}
      <div className="flex justify-between text-[11px] font-semibold text-gray-500">
        <span>Platform fee: 1%</span>
        <span className="text-red-500">−{fee.toFixed(2)} USDC</span>
      </div>

      {/* Net payout */}
      <div className="flex justify-between items-center border-t border-indigo-100 pt-3">
        <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
          Net payout
        </span>
        <span
          className={`text-xl font-black ${isProfit ? "text-emerald-600" : "text-red-500"}`}
        >
          {netPayout.toFixed(2)} USDC
        </span>
      </div>

      {/* Profit / loss badge */}
      <div
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black ${
          isProfit
            ? "bg-emerald-100 text-emerald-700"
            : "bg-red-100 text-red-600"
        }`}
      >
        <span>{isProfit ? "▲" : "▼"}</span>
        <span>
          {isProfit ? "+" : ""}
          {profit.toFixed(2)} USDC profit
        </span>
      </div>
    </div>
  );
}
