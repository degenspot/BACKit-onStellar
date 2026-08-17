"use client";

import { useMemo, useState } from "react";
import { signWithFreighter } from "@/lib/freighter";
import { useWalletContext } from "./WalletContext";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import {
  clampInputPrecision,
  formatStroops,
  fromStroops,
  parseAmountInput,
} from "@/lib/stellar/amounts";
import {
  calculateMaxStakeStroops,
  resolveStakeLimits,
  validateStake,
  type StakeValidationReason,
} from "@/lib/stellar/stakeLimits";

const REASON_MESSAGES: Partial<Record<StakeValidationReason, string>> = {
  WALLET_DISCONNECTED: "Connect a wallet to stake",
  BALANCE_UNAVAILABLE: "Balance unavailable — try again in a moment",
  ACCOUNT_NOT_FUNDED: "This account is not funded on the network yet",
  MISSING_TRUSTLINE: "Add a trustline for the stake asset first",
  ZERO_BALANCE: "No spendable balance for this asset",
  INSUFFICIENT_FEE_BALANCE: "Not enough XLM to cover the network fee",
  AMOUNT_REQUIRED: "Enter an amount",
  AMOUNT_NOT_POSITIVE: "Amount must be greater than zero",
  BELOW_MINIMUM: "Amount is below the minimum stake",
  ABOVE_MAXIMUM: "Amount is above the maximum stake",
  EXCEEDS_BALANCE: "Amount exceeds your spendable balance",
};

export default function StakeInput({ callId }: { callId: string }) {
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isConnected, publicKey, wallet } = useWalletContext();
  const balances = useWalletBalances(
    publicKey,
    wallet.status === "connected" ? wallet.network : null,
  );
  const limits = useMemo(() => resolveStakeLimits(), []);

  const maxStakeStroops = calculateMaxStakeStroops({
    assetBalanceStroops: balances.stakeAssetStroops,
    spendableXlmStroops: balances.spendableXlmStroops,
    stakeAssetIsNative: balances.asset.isNative,
    limits,
  });

  const amountStroops = parseAmountInput(amount);
  const validation = validateStake({
    amountStroops,
    spendableStakeStroops: maxStakeStroops,
    limits,
    isConnected,
    marketIsActive: true,
    balanceReady: balances.status === "ready" || balances.status === "unfunded",
    accountFunded: balances.status !== "unfunded",
    hasTrustline: balances.hasTrustline,
    hasFeeBalance: balances.spendableXlmStroops > 0n,
  });

  async function submitStake() {
    if (!validation.canSubmit || amountStroops === null) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calls/${callId}/stake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side, amount: fromStroops(amountStroops) }),
      });
      if (!res.ok) throw new Error(`Stake request failed (${res.status})`);

      const { xdr } = await res.json();
      await signWithFreighter(xdr);
      await balances.refresh();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stake failed");
    } finally {
      setLoading(false);
    }
  }

  const blockingMessage = validation.canSubmit
    ? null
    : REASON_MESSAGES[validation.reason];

  return (
    <div className="border p-4 rounded space-y-3">
      <div className="flex gap-2">
        {(["YES", "NO"] as const).map((s) => (
          <button
            key={s}
            className={`flex-1 p-2 border ${side === s ? "bg-black text-white" : ""}`}
            onClick={() => setSide(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <input
        type="text"
        inputMode="decimal"
        value={amount}
        placeholder={`Amount (${balances.asset.code})`}
        aria-label={`Amount in ${balances.asset.code}`}
        className="border p-2 w-full"
        onChange={(e) => setAmount(clampInputPrecision(e.target.value.trim()))}
      />

      {balances.status === "ready" && (
        <p className="text-xs text-gray-500">
          Spendable: {formatStroops(maxStakeStroops)} {balances.asset.code}
        </p>
      )}

      {blockingMessage && (
        <p role="status" className="text-xs text-amber-700">
          {blockingMessage}
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}

      <button
        onClick={submitStake}
        disabled={loading || !validation.canSubmit}
        className="bg-black text-white p-2 w-full disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "Confirming…" : "Stake"}
      </button>
    </div>
  );
}
