"use client";

import { useState } from "react";
import { CallDetailData } from "@/types";
import { useWalletContext } from "./WalletContext";
import { signWithFreighter } from "@/lib/freighter";

interface Props {
  call: CallDetailData;
  userStake: number;
  userSide: "YES" | "NO";
  payoutAmount: number;
}

type ClaimStatus = "idle" | "pending" | "confirmed" | "error";

export default function ClaimPayout({ call, userStake, userSide, payoutAmount }: Props) {
  const { isConnected, walletType, publicKey } = useWalletContext();
  const [status, setStatus] = useState<ClaimStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);

  const isWinner = call.outcome === userSide;
  const profit = payoutAmount - userStake;

  const handleClaim = async () => {
    if (!isConnected || alreadyClaimed) return;
    setStatus("pending");
    setErrorMsg(null);

    try {
      // Request unsigned claim transaction XDR from backend
      const res = await fetch(`/api/calls/${call.id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: publicKey }),
      });

      if (!res.ok) throw new Error(await res.text());
      const { xdr } = await res.json();

      // Sign with the connected wallet
      let signedXdr: string;
      if (walletType === "freighter") {
        signedXdr = await signWithFreighter(xdr);
      } else if (walletType === "lobstr") {
        if (!window.lobstr) throw new Error("Lobstr not available");
        const result = await window.lobstr.signTransaction(xdr);
        signedXdr = result.signedXDR;
      } else {
        throw new Error("Unsupported wallet for transaction signing");
      }

      // Submit signed transaction
      const submitRes = await fetch(`/api/calls/${call.id}/claim/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedXdr, userAddress: publicKey }),
      });

      if (!submitRes.ok) throw new Error(await submitRes.text());

      const { hash } = await submitRes.json();
      setTxHash(hash);
      setAlreadyClaimed(true);
      setStatus("confirmed");
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Transaction failed");
      setStatus("error");
    }
  };

  // Loser banner
  if (!isWinner) {
    return (
      <div className="bg-red-50 border border-red-100 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">😔</span>
          <h3 className="text-lg font-bold text-red-700">You Lost</h3>
        </div>
        <p className="text-sm text-red-600">
          You staked <span className="font-bold">{userStake} USDC</span> on{" "}
          <span className="font-bold">{userSide}</span>. The market resolved{" "}
          <span className="font-bold">{call.outcome}</span>.
        </p>
      </div>
    );
  }

  // Confirmed state
  if (status === "confirmed" && txHash) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-2xl">✅</span>
          <h3 className="text-lg font-bold text-green-700">Payout Claimed ✓</h3>
        </div>
        <p className="text-sm text-green-700 mb-3">
          <span className="font-bold">{payoutAmount} USDC</span> sent to your wallet.
        </p>
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono text-green-600 underline break-all"
        >
          {txHash}
        </a>
      </div>
    );
  }

  // Winner banner
  return (
    <div className="bg-green-50 border border-green-200 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl">🏆</span>
        <h3 className="text-lg font-bold text-green-700">You Won! Claim Your Payout</h3>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5 text-center">
        <div className="bg-white rounded-xl p-3 border border-green-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Your Stake</p>
          <p className="text-lg font-black text-gray-900">{userStake} <span className="text-xs text-gray-400">USDC</span></p>
        </div>
        <div className="bg-white rounded-xl p-3 border border-green-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Winning Side</p>
          <p className="text-lg font-black text-green-600">{userSide}</p>
        </div>
        <div className="bg-white rounded-xl p-3 border border-green-100">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Payout</p>
          <p className="text-lg font-black text-gray-900">{payoutAmount} <span className="text-xs text-gray-400">USDC</span></p>
        </div>
      </div>

      <p className="text-sm text-green-700 mb-4">
        Profit: <span className="font-bold text-green-600">+{profit.toFixed(2)} USDC</span>
      </p>

      {status === "error" && errorMsg && (
        <p className="text-xs text-red-600 mb-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {errorMsg}
        </p>
      )}

      <button
        onClick={handleClaim}
        disabled={status === "pending" || alreadyClaimed || !isConnected}
        className={`w-full py-4 rounded-2xl font-black text-base transition-all active:scale-95 flex items-center justify-center gap-2 ${
          alreadyClaimed
            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
            : status === "pending"
            ? "bg-green-400 text-white cursor-wait"
            : "bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-200"
        }`}
      >
        {status === "pending" ? (
          <>
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Pending…
          </>
        ) : alreadyClaimed ? (
          "Already Claimed"
        ) : (
          `Claim ${payoutAmount} USDC`
        )}
      </button>

      {!isConnected && (
        <p className="text-xs text-center text-gray-400 mt-2">Connect your wallet to claim</p>
      )}
    </div>
  );
}
