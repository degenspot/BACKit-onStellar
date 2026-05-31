"use client";

import { CallDetailData } from "@/types";
import ShareButton from "./ShareButton";

interface Props {
  call: CallDetailData;
  timeLeft: string;
}

export default function CallDetailHeader({ call, timeLeft }: Props) {
  // Extract target price from condition if available
  const targetPrice = call.conditionJson?.targetPrice || call.token.price * 1.5; // Fallback example
  
  return (
    <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white p-6 rounded-xl">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-3xl font-bold">{call.token.symbol}</span>
            <span className="text-gray-400 text-lg">/ USDC</span>
          </div>
          <div className="space-y-1">
            <p className="text-2xl font-semibold">
              Target: ${targetPrice.toLocaleString()}
            </p>
            <p className="text-gray-300">
              Current: ${call.token.price.toLocaleString()}
            </p>
          </div>
        </div>
        <div className="text-right flex flex-col items-end gap-2">
          <div>
            <div className="text-sm text-gray-400">Time Remaining</div>
            <div className="text-2xl font-mono font-bold text-orange-400">{timeLeft}</div>
          </div>
          <ShareButton
            marketTitle={`${call.token.symbol}/USDC — Target $${targetPrice.toLocaleString()}`}
            marketId={call.id}
            tokenPair={`${call.token.symbol}/USDC`}
          />
        </div>
      </div>
      
      {/* Creator info */}
      <div className="mt-4 pt-4 border-t border-gray-700 flex items-center gap-2 text-sm">
        <span className="text-gray-400">Created by:</span>
        <span className="font-mono">{call.creatorAddress.slice(0, 6)}...{call.creatorAddress.slice(-4)}</span>
        <span className="ml-auto bg-green-600 text-xs px-2 py-1 rounded">Creator</span>
      </div>
    </div>
  );
}