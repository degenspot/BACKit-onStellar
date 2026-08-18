"use client";

import ReactMarkdown from "react-markdown";
import { useCallback, useEffect, useMemo, useState } from "react";
import CallDetailHeader from "./CallDetailHeader";
import StakeDistributionBar from "./StakeDistributionBar";
import ActivityLog from "./ActivityLog";
import StakingInterface from "./StakingInterface";
import StakingDrawer from "./StakingDrawer";
import PriceChart from "./PriceChart";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useWalletContext } from "./WalletContext";
import ClaimPayout from "./ClaimPayout";
import PriceAlertToggle from "./PriceAlertToggle";
import BookmarkButton from "./BookmarkButton";
import ClosingAlertToggle from "./ClosingAlertToggle";
import {
  deriveOdds,
  describeApiError,
  fetchMarketStakes,
  fetchPortfolio,
  formatAmount,
  stroopsToNumber,
  type Market,
  type MarketStake,
  type PortfolioStake,
} from "@/lib/backend";

interface Props {
  market: Market;
  /** Re-reads the market after a stake or claim changes on-chain state. */
  onRefresh?: () => void;
}

export default function CallDetail({ market, onRefresh }: Props) {
  const [timeLeft, setTimeLeft] = useState("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [position, setPosition] = useState<PortfolioStake | null>(null);
  const [recentStakes, setRecentStakes] = useState<MarketStake[]>([]);
  const [stakesError, setStakesError] = useState<string | null>(null);
  const [stakesLoading, setStakesLoading] = useState(true);

  const isMobile = useMediaQuery("(max-width: 768px)");
  const { publicKey } = useWalletContext();

  const odds = useMemo(
    () => deriveOdds(market.totalYesStroops, market.totalNoStroops),
    [market.totalYesStroops, market.totalNoStroops],
  );

  const loadRecentStakes = useCallback(
    async (signal?: AbortSignal) => {
      setStakesLoading(true);

      try {
        const stakes = await fetchMarketStakes(market.id, 50, { signal });

        if (signal?.aborted) return;

        setRecentStakes(stakes);
        setStakesError(null);
      } catch (err) {
        if (signal?.aborted) return;

        // No fake activity: the log renders its own error/empty state instead.
        setRecentStakes([]);
        setStakesError(describeApiError(err));
      } finally {
        if (!signal?.aborted) {
          setStakesLoading(false);
        }
      }
    },
    [market.id],
  );

  useEffect(() => {
    const controller = new AbortController();

    loadRecentStakes(controller.signal);

    return () => controller.abort();
  }, [loadRecentStakes]);

  const loadPosition = useCallback(
    async (signal?: AbortSignal) => {
      if (!publicKey) {
        setPosition(null);
        return;
      }

      try {
        const portfolio = await fetchPortfolio(publicKey, { signal });

        if (signal?.aborted) return;

        setPosition(
          portfolio.stakes.find((stake) => stake.callId === market.id) ?? null,
        );
      } catch {
        if (!signal?.aborted) {
          setPosition(null);
        }
      }
    },
    [publicKey, market.id],
  );

  useEffect(() => {
    const controller = new AbortController();

    loadPosition(controller.signal);

    return () => controller.abort();
  }, [loadPosition]);

  useEffect(() => {
    if (!market.endTime) {
      setTimeLeft(market.resolved ? "Resolved" : "No deadline");
      return;
    }

    const tick = () => {
      const diff =
        new Date(market.endTime as string).getTime() - Date.now();

      if (diff <= 0) {
        setTimeLeft(market.resolved ? "Resolved" : "Closed");
        return false;
      }

      const hrs = Math.floor(diff / 36e5);
      const mins = Math.floor((diff % 36e5) / 6e4);
      const secs = Math.floor((diff % 6e4) / 1000);

      setTimeLeft(`${hrs}h ${mins}m ${secs}s`);

      return true;
    };

    tick();

    const interval = setInterval(() => {
      if (!tick()) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [market.endTime, market.resolved]);

  const handleStaked = useCallback(async () => {
    if (isMobile) {
      setIsDrawerOpen(false);
    }

    onRefresh?.();

    await Promise.all([loadRecentStakes(), loadPosition()]);
  }, [
    isMobile,
    onRefresh,
    loadRecentStakes,
    loadPosition,
  ]);

  const handleClaimed = useCallback(async () => {
    onRefresh?.();
    await loadPosition();
  }, [onRefresh, loadPosition]);

  const poolStroops =
    market.totalYesStroops + market.totalNoStroops;

  return (
    <main className="max-w-7xl mx-auto p-4 lg:py-10">
      {/* Desktop Layout */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-10">
        {/* Left column - Main content */}
        <div className="lg:col-span-2 space-y-8">
          <CallDetailHeader
            market={market}
            timeLeft={timeLeft}
            odds={odds}
          />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <ClosingAlertToggle
              callId={market.id}
              walletAddress={publicKey ?? undefined}
              hasStakeOrBookmark={
                !!position || market.isBookmarked
              }
            />

            <BookmarkButton
              callId={market.id}
              initialBookmarked={market.isBookmarked}
              initialCount={market.bookmarkCount}
            />
          </div>

          {/* Historical Price Chart */}
          {market.pairId && (
            <PriceChart
              pairId={market.pairId}
              startPrice={
                market.startPrice
                  ? Number(market.startPrice)
                  : undefined
              }
              createdAt={market.createdAt}
              currentPrice={
                market.currentPrice
                  ? Number(market.currentPrice)
                  : 0
              }
            />
          )}

          {/* Condition/Thesis section */}
          <div className="bg-white rounded-2xl border border-gray-100 p-8 shadow-sm">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <span className="w-1.5 h-6 bg-indigo-600 rounded-full" />
              Analysis &amp; Thesis
            </h2>

            <div className="prose prose-slate max-w-none prose-headings:font-bold prose-a:text-indigo-600">
              {market.thesis ? (
                <ReactMarkdown>{market.thesis}</ReactMarkdown>
              ) : (
                <p className="text-sm text-gray-400">
                  The creator did not publish a thesis for this market.
                </p>
              )}
            </div>
          </div>

          {/* Activity Log - Desktop */}
          <div className="hidden lg:block">
            <ActivityLog
              stakes={recentStakes}
              callId={market.id}
              stakeToken={market.stakeToken}
              loading={stakesLoading}
              error={stakesError}
              onRetry={() => loadRecentStakes()}
            />
          </div>
        </div>

        {/* Right column - Staking / Claim (Desktop) */}
        <div className="hidden lg:block space-y-8">
          {market.resolved && position ? (
            <ClaimPayout
              market={market}
              stake={position}
              onClaimed={handleClaimed}
            />
          ) : !market.resolved ? (
            <>
              <StakingInterface
                market={market}
                odds={odds}
                onStaked={handleStaked}
              />

              <PriceAlertToggle
                callId={market.id}
                walletAddress={publicKey ?? undefined}
              />
            </>
          ) : null}

          {/* Pool summary */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <h4 className="font-bold text-gray-900 uppercase tracking-widest text-xs">
                Market Liquidity
              </h4>

              <span className="bg-gray-100 text-gray-600 text-[10px] font-bold px-2 py-1 rounded-md">
                LIVE POOL
              </span>
            </div>

            <StakeDistributionBar
              yes={stroopsToNumber(market.totalYesStroops)}
              no={stroopsToNumber(market.totalNoStroops)}
              currency={market.stakeToken}
              variant="lg"
            />

            <p className="mt-4 text-xs text-gray-500">
              Total pool:{" "}
              <span className="font-bold text-gray-800">
                {formatAmount(poolStroops)} {market.stakeToken}
              </span>
            </p>
          </div>
        </div>

        {/* Mobile Staking Button */}
        {isMobile && !market.resolved && (
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-xl border-t border-gray-200 z-50">
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold shadow-lg shadow-indigo-100 active:scale-95 transition-all"
            >
              Place Stake — {Number(odds.yes).toFixed(2)}x /{" "}
              {Number(odds.no).toFixed(2)}x
            </button>
          </div>
        )}
      </div>

      {/* Activity Log - Mobile */}
      {isMobile && (
        <div className="mt-10 pb-24">
          {market.resolved && position && (
            <div className="mb-6">
              <ClaimPayout
                market={market}
                stake={position}
                onClaimed={handleClaimed}
              />
            </div>
          )}

          <ActivityLog
            stakes={recentStakes}
            callId={market.id}
            stakeToken={market.stakeToken}
            loading={stakesLoading}
            error={stakesError}
            onRetry={() => loadRecentStakes()}
          />
        </div>
      )}

      {/* Mobile Staking Drawer */}
      <StakingDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        market={market}
        odds={odds}
        onStaked={handleStaked}
      />
    </main>
  );
}