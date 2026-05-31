"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import FeedTabs from "@/components/FeedTabs";
import { CallCardSkeleton } from "@/components/CardCallSkeleton";
import { EmptyState } from "@/components/EmptyState";
import CallCard from "@/components/CallCard";
import { useFeed } from "@/hooks/useFeed";
import FilterBar, {
  FilterState,
  DEFAULT_FILTERS,
  SortOption,
  StatusFilter,
} from "@/components/FilterBar";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import Link from "next/link";
import { ArrowUp } from "lucide-react";

/** Parse URL search params into a FilterState */
function parseFiltersFromParams(params: URLSearchParams): FilterState {
  const status = params.get("status") as StatusFilter | null;
  const sort = (params.get("sort") as SortOption) || DEFAULT_FILTERS.sort;
  const token = params.get("token") || null;
  const minStake = Number(params.get("minStake") ?? 0);

  return {
    status: status ?? null,
    sort: ["newest", "ending_soon", "most_staked", "trending"].includes(sort)
      ? sort
      : DEFAULT_FILTERS.sort,
    token,
    minStake: isNaN(minStake) ? 0 : minStake,
  };
}

/** Serialize a FilterState into URL search params */
function buildSearchParams(
  tab: string,
  filters: FilterState
): URLSearchParams {
  const params = new URLSearchParams();
  if (tab !== "for-you") params.set("tab", tab);
  if (filters.status) params.set("status", filters.status);
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set("sort", filters.sort);
  if (filters.token) params.set("token", filters.token);
  if (filters.minStake > 0) params.set("minStake", String(filters.minStake));
  return params;
}

export default function FeedPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialise state from URL
  const [tab, setTab] = useState<"for-you" | "following">(
    (searchParams.get("tab") as "for-you" | "following") ?? "for-you"
  );
  const [filters, setFilters] = useState<FilterState>(() =>
    parseFiltersFromParams(searchParams)
  );

  // Sync state → URL whenever tab or filters change
  const syncUrl = useCallback(
    (nextTab: string, nextFilters: FilterState) => {
      const params = buildSearchParams(nextTab, nextFilters);
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, {
        scroll: false,
      });
    },
    [router, pathname]
  );

  const handleTabChange = (newTab: "for-you" | "following") => {
    setTab(newTab);
    syncUrl(newTab, filters);
  };

  const handleFilterChange = (newFilters: FilterState) => {
    setFilters(newFilters);
    syncUrl(tab, newFilters);
  };

  // Derive available tokens from loaded items for the token dropdown
  const { items, loading, loadingMore, hasMore, loadMore } = useFeed(
    tab,
    filters
  );

  const availableTokens = Array.from(
    new Set(
      items
        .map(
          (c: any) =>
            c.token ??
            c.conditionJson?.token ??
            c.stakeToken ??
            null
        )
        .filter(Boolean) as string[]
    )
  ).sort();

  const cacheKey = `${tab}-${filters.status ?? "all"}-${filters.sort}-${filters.token ?? "all"}-${filters.minStake}`;
  const { triggerRef, showBackToTop, scrollToTop } = useInfiniteScroll({
    loadMore,
    hasMore,
    loadingMore,
    items,
    cacheKey,
  });

  // Build a human-readable empty state message
  const emptyMessage = (() => {
    const parts: string[] = [];
    if (filters.status) parts.push(filters.status.toLowerCase());
    if (filters.token) parts.push(`${filters.token} token`);
    if (filters.minStake > 0)
      parts.push(`≥ ${filters.minStake.toLocaleString()} XLM pool`);

    const filterDesc = parts.length > 0 ? ` matching ${parts.join(", ")}` : "";

    if (tab === "for-you") {
      return filterDesc
        ? `No markets${filterDesc} found in "For You" feed.`
        : "No trending markets yet. Check back later!";
    }
    return filterDesc
      ? `No markets${filterDesc} from users you follow.`
      : "Follow users to see their markets.";
  })();

  return (
    <main className="max-w-2xl mx-auto p-4 relative min-h-screen pb-16">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Prediction Feed</h1>
        <p className="text-gray-600">
          Explore trending predictions and stake on outcomes
        </p>
      </div>

      <FeedTabs active={tab} onChange={handleTabChange} />

      <FilterBar
        filters={filters}
        onFilterChange={handleFilterChange}
        availableTokens={availableTokens}
      />

      {loading && (
        <div className="space-y-4 mt-4">
          {[...Array(6)].map((_, i) => (
            <CallCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && <EmptyState text={emptyMessage} />}

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
          <svg
            className="animate-spin h-8 w-8 text-indigo-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
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
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <div className="text-center text-gray-500 py-8 font-medium">
          No more markets
        </div>
      )}

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
