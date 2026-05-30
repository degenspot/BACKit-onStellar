"use client";

import { useState } from "react";
import FeedTabs from "@/components/FeedTabs";
import { CallCardSkeleton } from "@/components/CardCallSkeleton";
import { EmptyState } from "@/components/EmptyState";
import CallCard from "@/components/CallCard";
import { useFeed } from "@/hooks/useFeed";
import FilterBar from "@/components/FilterBar";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import Link from "next/link";
import { ArrowUp } from "lucide-react";

export default function FeedPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"for-you" | "following">("for-you");
  const [filters, setFilters] = useState<FeedFilters>(() => readFiltersFromSearchParams(searchParams));

  const { items, loading, loadingMore, hasMore, loadMore } = useFeed(tab, filters);

  const cacheKey = `${tab}-${filters.status || 'all'}`;
  const { triggerRef, showBackToTop, scrollToTop } = useInfiniteScroll({
    loadMore,
    hasMore,
    loadingMore,
    items,
    cacheKey,
  });

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
    <main className="max-w-2xl mx-auto p-4 relative min-h-screen pb-16">
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
        <div className="space-y-4 mt-4">
          {[...Array(6)].map((_, i) => (
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

      <div className="space-y-4 mt-4">
        {items.map((call) => (
          <Link key={call.id} href={`/calls/${call.id}`} className="block">
            <CallCard call={call} />
          </Link>
        ))}
      </div>

      {/* Infinite Scroll Trigger */}
      {hasMore && !loading && (
        <div ref={triggerRef} className="flex justify-center py-6">
          <svg className="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      )}

      {/* End of results message */}
      {!hasMore && items.length > 0 && (
        <div className="text-center text-gray-500 py-8 font-medium">
          No more markets
        </div>
      )}

      {/* Back to Top button */}
      {showBackToTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-lg transition-all duration-300 transform hover:scale-110 z-50 flex items-center justify-center"
          aria-label="Back to top"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </main>
  );
}
