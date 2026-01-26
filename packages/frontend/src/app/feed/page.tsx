"use client";

import { useEffect, useRef, useState } from "react";
import FeedTabs from "@/components/FeedTabs";
import { CallCardSkeleton } from "@/components/CardCallSkeleton";
import { EmptyState } from "@/components/EmptyState";
import CallCard from "@/components/CallCard";
import { useFeed } from "@/hooks/useFeed";

export default function FeedPage() {
  const [tab, setTab] = useState<"for-you" | "following">("for-you");
  const { items, loading, loadingMore, hasMore, loadMore } = useFeed(tab);

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

  return (
    <main className="max-w-xl mx-auto p-4">
      <FeedTabs active={tab} onChange={setTab} />

      {loading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <CallCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <EmptyState
          text={
            tab === "for-you"
              ? "No trending calls yet."
              : "Follow users to see their calls."
          }
        />
      )}

      <div className="space-y-3">
        {items.map((call) => (
          <CallCard key={call.id} call={call} />
        ))}
      </div>

      {hasMore && <div ref={loaderRef} className="h-10" />}

      {loadingMore && (
        <div className="mt-3 space-y-3">
          <CallCardSkeleton />
          <CallCardSkeleton />
        </div>
      )}
    </main>
  );
}
