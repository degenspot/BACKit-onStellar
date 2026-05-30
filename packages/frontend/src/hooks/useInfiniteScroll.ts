"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface UseInfiniteScrollProps {
  loadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  items: any[];
  cacheKey: string;
}

export function useInfiniteScroll({
  loadMore,
  hasMore,
  loadingMore,
  items,
  cacheKey,
}: UseInfiniteScrollProps) {
  const [showBackToTop, setShowBackToTop] = useState(false);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const isInitialMount = useRef(true);

  // Debounced loadMore to prevent rapid multiple fetches
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const debouncedLoadMore = useCallback(() => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }
    debounceTimeout.current = setTimeout(() => {
      if (hasMore && !loadingMore) {
        loadMore();
      }
    }, 250); // 250ms debounce
  }, [loadMore, hasMore, loadingMore]);

  // Observer callback
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const entry = entries[0];
      if (entry.isIntersecting) {
        debouncedLoadMore();
      }
    },
    [debouncedLoadMore]
  );

  // Set up IntersectionObserver
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(handleIntersect, {
      root: null,
      rootMargin: "150px", // Trigger slightly before reaching the bottom
      threshold: 0,
    });

    const currentTrigger = triggerRef.current;
    if (currentTrigger) {
      observerRef.current.observe(currentTrigger);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, [handleIntersect]);

  // Track scroll position to show/hide "Back to Top" button and save for restoration
  useEffect(() => {
    const handleScroll = () => {
      if (typeof window === "undefined") return;

      const scrollY = window.scrollY;
      const twoPagesHeight = window.innerHeight * 2;
      
      // Update showBackToTop if scrolled > 2 pages
      setShowBackToTop(scrollY > twoPagesHeight);

      // Save scroll position for the current cacheKey
      if (items.length > 0) {
        sessionStorage.setItem(`scroll-${cacheKey}`, scrollY.toString());
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [items, cacheKey]);

  // Scroll restoration: when items length changes and contains items, restore scroll position
  useEffect(() => {
    if (typeof window === "undefined" || items.length === 0) return;

    if (isInitialMount.current) {
      const savedScroll = sessionStorage.getItem(`scroll-${cacheKey}`);
      if (savedScroll) {
        const scrollY = parseInt(savedScroll, 10);
        if (scrollY > 0) {
          // Use requestAnimationFrame to ensure the DOM is updated/rendered
          requestAnimationFrame(() => {
            window.scrollTo(0, scrollY);
          });
        }
      }
      isInitialMount.current = false;
    }
  }, [items, cacheKey]);

  // Reset initial mount flag when cacheKey changes (e.g. switching tabs or filters)
  useEffect(() => {
    isInitialMount.current = true;
  }, [cacheKey]);

  const scrollToTop = () => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return {
    triggerRef,
    showBackToTop,
    scrollToTop,
  };
}
