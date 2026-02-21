"use client";

import { useEffect, useState } from "react";
import { fetchFeed } from "@/lib/api";

export function useFeed(type: "for-you" | "following", filters?: { status: string | null }) {
  const [items, setItems] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    resetAndFetch();
  }, [type, filters?.status]);

  async function resetAndFetch() {
    setLoading(true);
    setItems([]);
    setCursor(null);
    setHasMore(true);

    const data = await fetchFeed(type, undefined, filters);
    setItems(data.items);
    setCursor(data.nextCursor ?? null);
    setHasMore(!!data.nextCursor);
    setLoading(false);
  }

  async function loadMore() {
    if (!hasMore || loadingMore) return;

    setLoadingMore(true);
    const data = await fetchFeed(type, cursor ?? undefined, filters);

    setItems((prev: any[]) => [...prev, ...data.items]);
    setCursor(data.nextCursor ?? null);
    setHasMore(!!data.nextCursor);
    setLoadingMore(false);
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
