"use client";

import StakeBar from "./StakeBar";
import ShareButton from "./ShareButton";
import { useState, useEffect } from "react";

interface CallCardProps {
  call: any;
}

export default function CallCard({ call }: CallCardProps) {
  const [odds, setOdds] = useState<{ yes: number; no: number } | null>(null);

  useEffect(() => {
    fetch(`/api/calls/${call.id}/odds`)
      .then((res) => res.json())
      .then((data) => setOdds(data))
      .catch(() => setOdds({ yes: 2.0, no: 2.0 }));
  }, [call.id]);

  // Calculate time remaining
  const calculateTimeRemaining = () => {
    if (!call.endTime) return "Unknown";
    
    const now = new Date().getTime();
    const end = new Date(call.endTime).getTime();
    const diff = end - now;

    if (diff <= 0) return "Ended";

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // Determine status
  const getStatus = () => {
    if (call.resolved) return "Ended";
    if (call.outcome === 'CLAIMS_READY') return "Claims Ready";
    return "Open";
  };

  return (
    <div className="border rounded-2xl p-5 bg-white shadow-sm hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1">
      {/* Header with token and time */}
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl p-2.5 shadow-sm">
            <span className="font-bold text-lg text-white mb-0 leading-none">{call.token ? call.token[0] : '?'}</span>
          </div>
          <div>
            <div className="font-bold text-gray-900 leading-tight">{call.token || 'Unknown'}</div>
            <span className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
              getStatus() === "Open" ? "bg-green-100 text-green-700" :
              getStatus() === "Ended" ? "bg-gray-100 text-gray-600" :
              "bg-blue-100 text-blue-700"
            }`}>
              {getStatus()}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Ends In</div>
          <div className="text-sm font-mono font-medium text-orange-500 bg-orange-50 px-2 py-1 rounded-lg border border-orange-100 italic">{calculateTimeRemaining()}</div>
        </div>
      </div>

      {/* Condition */}
      <div className="mb-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Market Condition</p>
        <p className="font-semibold text-gray-800 text-lg leading-snug line-clamp-2">{call.condition}</p>
      </div>

      {/* Multipliers - NEW SECTION */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-green-50 rounded-xl p-3 border border-green-100 text-center group cursor-pointer hover:bg-green-100 transition-colors">
          <div className="text-[10px] font-bold text-green-600 uppercase mb-1">YES Payout</div>
          <div className="text-xl font-black text-green-700">{odds?.yes || '2.00'}x</div>
        </div>
        <div className="bg-red-50 rounded-xl p-3 border border-red-100 text-center group cursor-pointer hover:bg-red-100 transition-colors">
          <div className="text-[10px] font-bold text-red-600 uppercase mb-1">NO Payout</div>
          <div className="text-xl font-black text-red-700">{odds?.no || '2.00'}x</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="flex justify-between text-[10px] font-bold text-gray-400 uppercase mb-2">
          <span>Staking Distribution</span>
          <span>Pool: {((call.stakes?.yes || 0) + (call.stakes?.no || 0)).toLocaleString()} USDC</span>
        </div>
        <StakeBar yes={call.stakes?.yes || 0} no={call.stakes?.no || 0} />
      </div>

      {/* Creator info */}
      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="bg-gray-200 border-2 border-white rounded-full w-8 h-8 flex items-center justify-center">
              <span className="text-xs font-medium text-gray-700">
                {call.creatorAddress?.substring(0, 2)?.toUpperCase()}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase">Creator</div>
            <div className="text-xs font-medium text-gray-600 truncate max-w-[100px]">
              {call.creatorAddress?.substring(0, 6)}...{call.creatorAddress?.substring(call.creatorAddress.length - 4)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[10px] font-bold text-gray-400 uppercase">Participants</div>
            <div className="text-sm font-bold text-gray-700">{call.participants || 0}</div>
          </div>
          <ShareButton
            callId={call.id}
            marketTitle={call.condition}
            currentOdds={odds || undefined}
            compact
          />
        </div>
      </div>
    </div>
  );
}
