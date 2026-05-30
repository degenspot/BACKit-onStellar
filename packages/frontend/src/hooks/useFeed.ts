"use client";

import { useEffect, useState } from "react";
import { fetchFeed } from "@/lib/api";

export function useFeed(type: "for-you" | "following", filters?: { status: string | null }) {
  const cacheKey = `feed-cache-${type}-${filters?.status || 'all'}`;

  const [items, setItems] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setItems(parsed.items || []);
          setCursor(parsed.cursor ?? null);
          setHasMore(parsed.hasMore ?? true);
          setLoading(false);
          return;
        } catch (e) {
          console.error("Failed to parse cached feed", e);
        }
      }
    }
    resetAndFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, filters?.status]);

  async function resetAndFetch() {
    setLoading(true);
    setItems([]);
    setCursor(null);
    setHasMore(true);

    try {
      const data = await fetchFeed(type, undefined, filters);
      setItems(data.items);
      setCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);

      if (typeof window !== "undefined") {
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            items: data.items,
            cursor: data.nextCursor ?? null,
            hasMore: !!data.nextCursor,
          })
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!hasMore || loadingMore) return;

    setLoadingMore(true);
    try {
      const data = await fetchFeed(type, cursor ?? undefined, filters);
      const newItems = [...items, ...data.items];

      setItems(newItems);
      setCursor(data.nextCursor ?? null);
      setHasMore(!!data.nextCursor);

      if (typeof window !== "undefined") {
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            items: newItems,
            cursor: data.nextCursor ?? null,
            hasMore: !!data.nextCursor,
          })
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMore(false);
    }
  }

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    refresh: resetAndFetch,
  };
}
