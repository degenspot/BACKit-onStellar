"use client";

import { useEffect, useRef, useState } from "react";
import FeedTabs from "@/components/FeedTabs";
import { CallCardSkeleton } from "@/components/CardCallSkeleton";
import { EmptyState } from "@/components/EmptyState";
import CallCard from "@/components/CallCard";
import { useFeed } from "@/hooks/useFeed";
import FilterBar from "@/components/FilterBar";

export default function FeedPage() {
  const [tab, setTab] = useState<"for-you" | "following">("for-you");
  const [filters, setFilters] = useState<{ status: string | null }>({ status: null });
  
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

  const handleFilterChange = (newFilters: { status: string | null }) => {
    setFilters(newFilters);
  };

  return (
    <main className="max-w-2xl mx-auto p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Prediction Feed</h1>
        <p className="text-gray-600">Explore trending predictions and stake on outcomes</p>
      </div>
      
      <FeedTabs active={tab} onChange={setTab} />
      <FilterBar onFilterChange={handleFilterChange} />

      {loading && (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <CallCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <EmptyState
          text={
            tab === "for-you"
              ? filters.status
                ? `No ${filters.status.toLowerCase()} calls found in "For You" feed.`
                : "No trending calls yet. Check back later for new predictions!"
              : filters.status
                ? `No ${filters.status.toLowerCase()} calls from users you follow.`
                : "Follow users to see their calls."
          }
        />
      )}

      <div className="space-y-4">
        {items.map((call) => (
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
