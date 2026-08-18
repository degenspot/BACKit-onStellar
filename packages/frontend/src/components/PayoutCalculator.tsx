"use client";

import { divideToDecimalString, formatAmount } from "@/lib/backend";

interface Props {
  /** Persisted YES pool in stroops. */
  yesPoolStroops: bigint;
  /** Persisted NO pool in stroops. */
  noPoolStroops: bigint;
  /** Stake amount in stroops, or `null` when the input is empty/invalid. */
  amountStroops: bigint | null;
  side: "YES" | "NO" | null;
  stakeToken: string;
}

/** Platform fee in basis points (1%). */
const PLATFORM_FEE_BPS = 100n;
const BPS = 10_000n;

/**
 * Parimutuel payout including the user's own stake:
 * `stake * (pool + stake) / (sidePool + stake)`.
 *
 * Everything is integer math on stroops, so the preview matches what the
 * contract pays out for the same pool state.
 */
export function calculateGrossPayout(
  amountStroops: bigint,
  sidePoolStroops: bigint,
  poolStroops: bigint,
): bigint {
  const newSidePool = sidePoolStroops + amountStroops;
  if (newSidePool <= 0n) return amountStroops;
  return (amountStroops * (poolStroops + amountStroops)) / newSidePool;
}

export default function PayoutCalculator({
  yesPoolStroops,
  noPoolStroops,
  amountStroops,
  side,
  stakeToken,
}: Props) {
  if (!side || amountStroops === null || amountStroops <= 0n) return null;

  const pool = yesPoolStroops + noPoolStroops;
  const sidePool = side === "YES" ? yesPoolStroops : noPoolStroops;
  const gross = calculateGrossPayout(amountStroops, sidePool, pool);
  const fee = (gross * PLATFORM_FEE_BPS) / BPS;
  const net = gross - fee;
  const profit = net - amountStroops;
  const isProfit = profit > 0n;
  const effectiveMultiplier = divideToDecimalString(gross, amountStroops, 2);

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5 space-y-3 text-sm">
      {pool === 0n && (
        <p className="text-[10px] text-indigo-400 uppercase tracking-widest font-bold">
          Empty pool — you would be the first staker
        </p>
      )}

      <p className="text-gray-700 font-medium leading-snug">
        If you stake{" "}
        <span className="font-black text-gray-900">
          {formatAmount(amountStroops)} {stakeToken}
        </span>{" "}
        on{" "}
        <span
          className={`font-black ${side === "YES" ? "text-green-600" : "text-red-600"}`}
        >
          {side}
        </span>
        , your potential payout is{" "}
        <span className="font-black text-indigo-700">
          {formatAmount(gross)} {stakeToken} ({effectiveMultiplier}x)
        </span>
        .
      </p>

      <div className="flex justify-between text-[11px] font-semibold text-gray-500">
        <span>Platform fee: 1%</span>
        <span className="text-red-500">
          −{formatAmount(fee)} {stakeToken}
        </span>
      </div>

      <div className="flex justify-between items-center border-t border-indigo-100 pt-3">
        <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">
          Net payout
        </span>
        <span
          className={`text-xl font-black ${isProfit ? "text-emerald-600" : "text-red-500"}`}
        >
          {formatAmount(net)} {stakeToken}
        </span>
      </div>

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
          {formatAmount(profit)} {stakeToken} profit
        </span>
      </div>
    </div>
  );
}
