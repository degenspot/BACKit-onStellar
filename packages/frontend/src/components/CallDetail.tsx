"use client";

import ReactMarkdown from "react-markdown";
import { useEffect, useState } from "react";
import CallDetailHeader from "./CallDetailHeader";
import StakeBar from "./StakeBar";
import ActivityLog from "./ActivityLog";
import StakingInterface from "./StakingInterface";
import StakingDrawer from "./StakingDrawer";
import PriceChart from "./PriceChart";
import { CallDetailData } from "@/types";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useWalletContext } from "./WalletContext";
import ClaimPayout from "./ClaimPayout";

interface UserPosition {
  stake: number;
  side: "YES" | "NO";
  payout: number;
}

export default function CallDetail({ call }: { call: CallDetailData }) {
  const [timeLeft, setTimeLeft] = useState("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [odds, setOdds] = useState<{ yes: number; no: number } | null>(null);
  const [userPosition, setUserPosition] = useState<UserPosition | null>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { publicKey } = useWalletContext();

  useEffect(() => {
    if (call.resolved && publicKey) {
      fetch(`/api/calls/${call.id}/position?address=${publicKey}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => data && setUserPosition(data))
        .catch(() => null);
    }
  }, [call.id, call.resolved, publicKey]);

  useEffect(() => {
    // Fetch odds from backend
    fetch(`/api/calls/${call.id}/odds`)
      .then((res) => res.json())
      .then((data) => setOdds(data))
      .catch(() => setOdds({ yes: 2.0, no: 2.0 }));

    const interval = setInterval(() => {
      const diff = new Date(call.endTime).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft("Resolved");
        clearInterval(interval);
      } else {
        const hrs = Math.floor(diff / 36e5);
        const mins = Math.floor((diff % 36e5) / 6e4);
        const secs = Math.floor((diff % 6e4) / 1000);
        setTimeLeft(`${hrs}h ${mins}m ${secs}s`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [call.endTime, call.id]);

  const handleStake = async (amount: number, side: 'YES' | 'NO') => {
    // Implement actual staking logic here
    console.log(`Staking ${amount} USDC on ${side} for call ${call.id}`);
    // Close drawer after successful stake on mobile
    if (isMobile) setIsDrawerOpen(false);
  };

  return (
    <main className="max-w-7xl mx-auto p-4 lg:py-10">
      {/* Desktop Layout */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-10">
        {/* Left column - Main content */}
        <div className="lg:col-span-2 space-y-8">
          <CallDetailHeader call={call} timeLeft={timeLeft} odds={odds} />

          {/* Historical Price Chart */}
          <PriceChart
            pairId={call.pairId}
            startPrice={call.startPrice}
            createdAt={call.createdAt}
            currentPrice={call.token.price}
          />

          {/* Condition/Thesis section */}
          <div className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-indigo-600 rounded-full" />
              Analysis & Thesis
            </h2>
            <div className="prose prose-slate max-w-none prose-headings:font-bold prose-a:text-indigo-600">
              <ReactMarkdown>{call.thesis}</ReactMarkdown>
            </div>
          </div>

          {/* Activity Log - Desktop */}
          <div className="hidden lg:block">
            <ActivityLog participants={call.participants} callId={call.id} />
          </div>
        </div>

        {/* Right column - Staking / Claim (Desktop) */}
        <div className="hidden lg:block space-y-8">
          {call.resolved && userPosition ? (
            <ClaimPayout
              call={call}
              userStake={userPosition.stake}
              userSide={userPosition.side}
              payoutAmount={userPosition.payout}
            />
          ) : !call.resolved ? (
            <StakingInterface call={call} onStake={handleStake} odds={odds} />
          ) : null}
          
          {/* Pool summary */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h4 className="font-bold text-gray-900 uppercase tracking-widest text-xs">Market Liquidity</h4>
              <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-1 rounded-md">LIVE POOL</span>
            </div>
            <StakeBar yes={call.stakes.yes} no={call.stakes.no} />
            <div className="mt-6 flex justify-between items-end">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Total Vaulted</p>
                <p className="text-2xl font-black text-gray-900">{(call.stakes.yes + call.stakes.no).toLocaleString()} <span className="text-gray-400 text-sm">USDC</span></p>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Staking Button */}
        {isMobile && !call.resolved && (
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-xl border-t border-gray-200 z-50">
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold shadow-lg shadow-indigo-100 active:scale-95 transition-all"
            >
              Place Stake — {odds?.yes || '2.0'}x / {odds?.no || '2.0'}x
            </button>
          </div>
        )}
      </div>

      {/* Activity Log - Mobile */}
      {isMobile && (
        <div className="mt-10 pb-24">
          {call.resolved && userPosition && (
            <div className="mb-6">
              <ClaimPayout
                call={call}
                userStake={userPosition.stake}
                userSide={userPosition.side}
                payoutAmount={userPosition.payout}
              />
            </div>
          )}
          <ActivityLog participants={call.participants} callId={call.id} />
        </div>
      )}

      {/* Mobile Staking Drawer */}
      <StakingDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        call={call}
        onStake={handleStake}
        odds={odds}
      />
    </main>
  );
}
