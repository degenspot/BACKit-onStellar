"use client";

import StakeBar from "./StakeBar";
import Image from "next/image";

interface CallCardProps {
  call: any;
}

export default function CallCard({ call }: CallCardProps) {
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
    <div className="border rounded-xl p-4 bg-white shadow-sm hover:shadow-md transition-shadow duration-200">
      {/* Header with token and time */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2">
          <div className="bg-gray-100 rounded-full p-2">
            <span className="font-bold text-lg">{call.token}</span>
          </div>
          <div className="flex items-center gap-2 ml-2">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
              getStatus() === "Open" ? "bg-green-100 text-green-800" :
              getStatus() === "Ended" ? "bg-gray-100 text-gray-800" :
              "bg-blue-100 text-blue-800"
            }`}>
              {getStatus()}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-500">Time Remaining</div>
          <div className="text-sm font-medium text-orange-500">{calculateTimeRemaining()}</div>
        </div>
      </div>

      {/* Condition */}
      <div className="mb-3">
        <p className="text-sm text-gray-600">Condition:</p>
        <p className="font-medium">{call.condition}</p>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
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
            {/* Reputation badge */}
            <div className="absolute -bottom-1 -right-1 bg-yellow-400 rounded-full p-1 border border-white">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 text-yellow-700">
                <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
          <div>
            <div className="text-sm font-medium">Creator</div>
            <div className="text-xs text-gray-500 truncate max-w-[120px]">
              {call.creatorAddress?.substring(0, 6)}...{call.creatorAddress?.substring(call.creatorAddress.length - 4)}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">Participants</div>
          <div className="text-sm font-medium">{call.participants || 0}</div>
        </div>
      </div>
    </div>
  );
}
