"use client";

import ShareButton from "./ShareButton";
import type { Market, MarketOdds } from "@/lib/backend";

interface Props {
  market: Market;
  timeLeft: string;
  odds?: MarketOdds | null;
}

function formatPrice(value: string | null): string | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString() : value;
}

export default function CallDetailHeader({ market, timeLeft, odds }: Props) {
  const targetPrice = formatPrice(market.targetPrice);
  const currentPrice = formatPrice(market.currentPrice);
  const pair = market.pairId ?? market.tokenSymbol ?? market.title;

  return (
    <div className="bg-gradient-to-r from-gray-900 to-gray-800 text-white p-6 rounded-xl">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-3xl font-bold">
              {market.tokenSymbol ?? market.title}
            </span>
            {market.pairId && (
              <span className="text-gray-400 text-lg">
                / {market.pairId.split("/")[1] ?? market.stakeToken}
              </span>
            )}
          </div>
          <div className="space-y-1">
            {targetPrice ? (
              <p className="text-2xl font-semibold">Target: ${targetPrice}</p>
            ) : (
              <p className="text-2xl font-semibold">{market.title}</p>
            )}
            {currentPrice && (
              <p className="text-gray-300">Current: ${currentPrice}</p>
            )}
            {odds && (
              <p className="text-sm text-gray-400">
                UP {Number(odds.yes).toFixed(2)}x &nbsp;·&nbsp; DOWN{" "}
                {Number(odds.no).toFixed(2)}x
              </p>
            )}
          </div>
        </div>
        <div className="text-right flex flex-col items-end gap-2">
          <div>
            <div className="text-sm text-gray-400">Time Remaining</div>
            <div className="text-2xl font-mono font-bold text-orange-400">
              {timeLeft}
            </div>
          </div>
          <ShareButton
            marketTitle={market.title}
            marketId={market.id}
            {...(odds
              ? { oddsUp: Number(odds.yes), oddsDown: Number(odds.no) }
              : {})}
            {...(pair ? { tokenPair: pair } : {})}
          />
        </div>
      </div>

      {/* Creator info */}
      <div className="mt-4 pt-4 border-t border-gray-700 flex items-center gap-2 text-sm">
        <span className="text-gray-400">Created by:</span>
        <span className="font-mono">
          {market.creatorAddress.slice(0, 6)}...
          {market.creatorAddress.slice(-4)}
        </span>
        <span className="ml-auto bg-green-600 text-xs px-2 py-1 rounded">
          Creator
        </span>
      </div>
    </div>
  );
}
