"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import FeedTabs from "@/components/FeedTabs";
import { CallCardSkeleton } from "@/components/CardCallSkeleton";
import { EmptyState } from "@/components/EmptyState";
import CallCard from "@/components/CallCard";
import { useFeed } from "@/hooks/useFeed";
import FilterBar, { type FeedFilters, type SortOption } from "@/components/FilterBar";

const defaultFilters: FeedFilters = {
  status: "ALL",
  sort: "newest",
  token: "ALL",
  minStake: 0,
};

function readFiltersFromSearchParams(searchParams: ReturnType<typeof useSearchParams>): FeedFilters {
  const status = (searchParams.get("status") || "ALL").toUpperCase();
  const sort = (searchParams.get("sort") || "newest") as SortOption;
  const token = searchParams.get("token") || "ALL";
  const minStake = Number(searchParams.get("minStake") || 0);

  return {
    status: status === "OPEN" || status === "RESOLVED" ? status : "ALL",
    sort: ["newest", "ending-soon", "most-staked", "trending"].includes(sort) ? sort : "newest",
    token,
    minStake: Number.isFinite(minStake) && minStake > 0 ? minStake : 0,
  };
}

export default function FeedPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"for-you" | "following">("for-you");
  const [filters, setFilters] = useState<FeedFilters>(() => readFiltersFromSearchParams(searchParams));

  const { items, loading, loadingMore, hasMore, loadMore } = useFeed(tab, filters);

  const loaderRef = useRef<HTMLDivElement | null>(null);

  // Infinite scroll
  useEffect(() => {
    if (!loaderRef.current) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMore();
      }
    });

    observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [loadMore]);

  useEffect(() => {
    const nextParams = new URLSearchParams();

    if (filters.status !== "ALL") nextParams.set("status", filters.status);
    if (filters.sort !== "newest") nextParams.set("sort", filters.sort);
    if (filters.token !== "ALL") nextParams.set("token", filters.token);
    if (filters.minStake > 0) nextParams.set("minStake", String(filters.minStake));

    const nextQuery = nextParams.toString();
    const currentQuery = searchParams.toString();

    if (nextQuery !== currentQuery) {
      router.replace(nextQuery ? `/feed?${nextQuery}` : "/feed", { scroll: false });
    }
  }, [filters, router, searchParams]);

  const availableTokens = useMemo(() => {
    const tokens = new Set<string>();

    items.forEach((item) => {
      const token = item.token?.symbol || item.token || item.marketToken || item.assetSymbol;
      if (token) tokens.add(String(token));
    });

    return Array.from(tokens).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const activeFilterCount = [
    filters.status !== "ALL",
    filters.sort !== "newest",
    filters.token !== "ALL",
    filters.minStake > 0,
  ].filter(Boolean).length;

  const displayedItems = useMemo(() => {
    const normalized = [...items];

    const getStatus = (call: any) => {
      if (call.status) return String(call.status).toUpperCase();
      if (call.resolutionStatus) return String(call.resolutionStatus).toUpperCase();
      if (call.resolved || call.isResolved) return "RESOLVED";
      return "OPEN";
    };

    const getToken = (call: any) => String(call.token?.symbol || call.token || call.marketToken || call.assetSymbol || "");
    const getPool = (call: any) => Number(call.totalStake ?? call.totalPool ?? call.poolSize ?? ((call.stakes?.yes || 0) + (call.stakes?.no || 0)) ?? 0);
    const getCreatedAt = (call: any) => new Date(call.createdAt || call.created_at || call.startTime || call.startTs || 0).getTime();
    const getEndAt = (call: any) => new Date(call.endTime || call.endTs || call.expiresAt || 0).getTime();
    const getTrendScore = (call: any) => Number(call.participants || 0) + Number(call.totalStake || 0) + Number(call.trendingScore || 0);

    return normalized
      .filter((call) => {
        const status = getStatus(call);
        const statusMatch = filters.status === "ALL" || status === filters.status;
        const tokenMatch = filters.token === "ALL" || getToken(call) === filters.token;
        const stakeMatch = getPool(call) >= filters.minStake;

        return statusMatch && tokenMatch && stakeMatch;
      })
      .sort((a, b) => {
        switch (filters.sort) {
          case "ending-soon":
            return getEndAt(a) - getEndAt(b);
          case "most-staked":
            return getPool(b) - getPool(a);
          case "trending":
            return getTrendScore(b) - getTrendScore(a);
          case "newest":
          default:
            return getCreatedAt(b) - getCreatedAt(a);
        }
      });
  }, [filters, items]);

  const handleClearFilters = () => {
    setFilters(defaultFilters);
  };

  return (
    <main className="max-w-2xl mx-auto p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Prediction Feed</h1>
        <p className="text-gray-600">Explore trending predictions and stake on outcomes</p>
      </div>
      
      <FeedTabs active={tab} onChange={setTab} />
      <FilterBar
        filters={filters}
        availableTokens={availableTokens}
        activeFilterCount={activeFilterCount}
        onFilterChange={setFilters}
        onClearFilters={handleClearFilters}
      />

      {loading && (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <CallCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!loading && displayedItems.length === 0 && (
        <EmptyState
          text={
            tab === "for-you"
              ? filters.status !== "ALL"
                ? `No ${filters.status.toLowerCase()} calls found in "For You" feed.`
                : "No trending calls yet. Check back later for new predictions!"
              : filters.status !== "ALL"
                ? `No ${filters.status.toLowerCase()} calls from users you follow.`
                : "Follow users to see their calls."
          }
        />
      )}

      <div className="space-y-4">
        {displayedItems.map((call) => (
          <CallCard key={call.id} call={call} />
        ))}
      </div>

      {hasMore && <div ref={loaderRef} className="h-10" />}

      {loadingMore && (
        <div className="mt-4 space-y-4">
          <CallCardSkeleton />
          <CallCardSkeleton />
        </div>
      )}
    </main>
  );
}
