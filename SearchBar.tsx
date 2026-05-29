"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, TrendingUp, Users, Coins, X, History, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

// --- Types ---

/**
 * Supported result categories for grouping
 */
export type SearchCategory = "Markets" | "Users" | "Tokens";

/**
 * Unified result schema for search operations
 */
export interface SearchResult {
  id: string;
  type: "Market" | "User" | "Token";
  title: string;
  description?: string;
  href: string;
}

/**
 * API response schema for search queries
 */
export interface SearchResponse {
  results: SearchResult[];
}

const CATEGORY_MAP: Record<string, SearchCategory> = {
  Market: "Markets",
  User: "Users",
  Token: "Tokens",
};

const CATEGORY_ICONS: Record<SearchCategory, React.ReactNode> = {
  Markets: <TrendingUp className="h-4 w-4 text-emerald-400" />,
  Users: <Users className="h-4 w-4 text-sky-400" />,
  Tokens: <Coins className="h-4 w-4 text-amber-400" />,
};

// --- Custom Hooks ---

/**
 * Debounce hook to delay execution of search queries
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const RECENT_SEARCHES_KEY = "backit_recent_searches";

/**
 * Unified Global Search Bar Component
 * Implements accessible search with grouping, keyboard navigation, and local cache.
 */
export function SearchBar() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);

  const debouncedQuery = useDebounce(query, 300);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load recent searches from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved));
      } catch (e) {
        setRecentSearches([]);
      }
    }
  }, []);

  const saveRecentSearch = (term: string) => {
    const updated = [term, ...recentSearches.filter((t) => t !== term)].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  };

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen(true);
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  // Click outside and accessibility closures
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEsc);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen]);

  // Fetch grouped results
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    const fetchResults = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`);
        if (!response.ok) throw new Error("Search failed");
        const data: SearchResponse = await response.json();
        setResults(data.results);
        setSelectedIndex(data.results.length > 0 ? 0 : -1);
      } catch (error) {
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchResults();
  }, [debouncedQuery]);

  const handleSelect = (result: SearchResult | string) => {
    if (typeof result === "string") {
      setQuery(result);
      setIsOpen(true);
    } else {
      saveRecentSearch(result.title);
      router.push(result.href);
      setIsOpen(false);
      setQuery("");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (e.key === "Enter") {
      if (selectedIndex >= 0 && results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      } else if (query.trim()) {
        saveRecentSearch(query.trim());
        router.push(`/feed?search=${encodeURIComponent(query)}`);
        setIsOpen(false);
      }
    }
  };

  const groupedResults = results.reduce((acc, result) => {
    const cat = CATEGORY_MAP[result.type];
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(result);
    return acc;
  }, {} as Record<SearchCategory, SearchResult[]>);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className={`flex items-center gap-2 rounded-2xl border px-3 py-2 transition-all ${isOpen ? "border-blue-500/50 bg-slate-900 ring-2 ring-blue-500/20" : "border-white/10 bg-white/5 hover:border-white/20"}`}>
        <Search className={`h-4 w-4 ${isOpen ? "text-blue-400" : "text-slate-400"}`} />
        <input ref={inputRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} onFocus={() => setIsOpen(true)} onKeyDown={onKeyDown} placeholder="Search markets, users..." className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500" aria-label="Search global" autoComplete="off" />
        <div className="hidden items-center gap-1 sm:flex"><kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">⌘K</kbd></div>
        {query && <button onClick={() => setQuery("")} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>}
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 max-h-[420px] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950 p-2 shadow-2xl backdrop-blur-xl z-[100]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
          ) : results.length > 0 ? (
            <div className="space-y-4 py-2">
              {(Object.keys(groupedResults) as SearchCategory[]).map((category) => (
                <div key={category}>
                  <div className="mb-1 flex items-center gap-2 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">{CATEGORY_ICONS[category]}{category}</div>
                  <div className="space-y-0.5">
                    {groupedResults[category].map((result) => (
                      <button key={result.id} onClick={() => handleSelect(result)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all ${results.indexOf(result) === selectedIndex ? "bg-white/10 text-white translate-x-1" : "text-slate-300 hover:bg-white/5"}`}>
                        <div className="flex-1 overflow-hidden">
                          <div className="truncate text-sm font-medium">{result.title}</div>
                          {result.description && <div className="truncate text-[11px] text-slate-500">{result.description}</div>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : query.trim() ? (
            <div className="py-12 text-center"><p className="text-sm font-medium text-slate-300">No results found</p></div>
          ) : (
            <div className="py-2">
              <div className="mb-2 px-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><History className="h-3 w-3" />Recent Searches</div>
              {recentSearches.length > 0 ? (
                recentSearches.map((term) => (
                  <button key={term} onClick={() => handleSelect(term)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-white/5"><Search className="h-3.5 w-3.5 text-slate-500" />{term}</button>
                ))
              ) : (
                <div className="px-3 py-4 text-xs text-slate-500">No recent searches</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}