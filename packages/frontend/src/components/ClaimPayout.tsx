"use client";

import { useState } from "react";
import { useWalletContext } from "./WalletContext";
import { signTransactionWithWallet } from "@/lib/walletSigning";
import GasFeeDisplay from "./GasFeeDisplay";
import {
  claimPayout,
  describeApiError,
  formatAmount,
  type Market,
  type PortfolioStake,
} from "@/lib/backend";

interface Props {
  market: Market;
  /** The connected wallet's position on this market. */
  stake: PortfolioStake;
  /** Called after a claim transaction has been submitted successfully. */
  onClaimed?: () => void | Promise<void>;
}

type ClaimStatus = "idle" | "pending" | "confirmed" | "error";

export default function ClaimPayout({ market, stake, onClaimed }: Props) {
  const { isConnected, walletType, publicKey } = useWalletContext();
  const [status, setStatus] = useState<ClaimStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(stake.claimTxHash);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const alreadyClaimed = stake.status === "CLAIMED" || status === "confirmed";
  const isWinner = stake.status !== "LOST";
  const payoutStroops = stake.payoutStroops ?? 0n;
  const profitStroops = payoutStroops - stake.amountStroops;

  const handleClaim = async () => {
    if (!isConnected || !publicKey || alreadyClaimed) return;
    setStatus("pending");
    setErrorMsg(null);

    try {
      const result = await claimPayout(market.id, publicKey, (xdr) =>
        signTransactionWithWallet(walletType, xdr),
      );
      setTxHash(result.hash);
      setStatus("confirmed");
      await onClaimed?.();
    } catch (err) {
      setErrorMsg(describeApiError(err));
      setStatus("error");
    }
  };

  // Loser banner
  if (!isWinner) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-red-700 mb-3">You Lost</h3>
        <p className="text-sm text-red-600">
          You staked{" "}
          <span className="font-bold">
            {formatAmount(stake.amountStroops)} {market.stakeToken}
          </span>{" "}
          on <span className="font-bold">{stake.position}</span>. The market
          resolved <span className="font-bold">{market.outcome}</span>.
        </p>
      </div>
    );
  }

  // Confirmed / already-claimed state
  if (alreadyClaimed) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-6">
        <h3 className="text-lg font-bold text-green-700 mb-3">
          Payout Claimed
        </h3>
        <p className="text-sm text-green-700 mb-3">
          <span className="font-bold">
            {formatAmount(payoutStroops)} {market.stakeToken}
          </span>{" "}
          sent to your wallet.
        </p>
        {txHash && (
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-green-600 underline break-all"
          >
            {txHash}
          </a>
        )}
      </div>
    );
  }

  // Winner banner
  return (
    <div className="bg-green-50 border border-green-200 rounded-2xl p-6">
      <h3 className="text-lg font-bold text-green-700 mb-4">
        You Won! Claim Your Payout
      </h3>

      <div className="grid grid-cols-3 gap-3 mb-5 text-center">
        <div className="bg-white rounded-xl p-3 border border-green-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
            Your Stake
          </p>
          <p className="text-lg font-black text-gray-900">
            {formatAmount(stake.amountStroops)}{" "}
            <span className="text-xs text-gray-400">{market.stakeToken}</span>
          </p>
        </div>
        <div className="bg-white rounded-xl p-3 border border-green-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
            Winning Side
          </p>
          <p className="text-lg font-black text-green-600">{stake.position}</p>
        </div>
        <div className="bg-white rounded-xl p-3 border border-green-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
            Payout
          </p>
          <p className="text-lg font-black text-gray-900">
            {formatAmount(payoutStroops)}{" "}
            <span className="text-xs text-gray-400">{market.stakeToken}</span>
          </p>
        </div>
      </div>

      <p className="text-sm text-green-700 mb-4">
        Profit:{" "}
        <span className="font-bold text-green-600">
          +{formatAmount(profitStroops)} {market.stakeToken}
        </span>
      </p>

      <div className="mb-3">
        <GasFeeDisplay />
      </div>

      {status === "error" && errorMsg && (
        <p
          role="alert"
          className="text-xs text-red-600 mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
        >
          {errorMsg}
        </p>
      )}

      <button
        onClick={handleClaim}
        disabled={status === "pending" || !isConnected}
        className={`w-full py-4 rounded-2xl font-black text-base transition-all active:scale-95 flex items-center justify-center gap-2 ${
          status === "pending"
            ? "bg-green-400 text-white cursor-wait"
            : !isConnected
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-200"
        }`}
      >
        {status === "pending" ? (
          <>
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
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
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Pending…
          </>
        ) : (
          `Claim ${formatAmount(payoutStroops)} ${market.stakeToken}`
        )}
      </button>

      {!isConnected && (
        <p className="text-xs text-center text-gray-400 mt-2">
          Connect your wallet to claim
        </p>
      )}
    </div>
  );
}
