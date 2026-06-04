"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  KeyboardEvent,
} from "react";
import { Dialog, Transition } from "@headlessui/react";
import {
  Search,
  X,
  Clock,
  TrendingUp,
  User,
  Coins,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import debounce from "lodash.debounce";
import {
  fetchSearch,
  type SearchResponse,
  type SearchResultMarket,
  type SearchResultToken,
  type SearchResultUser,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SearchResult =
  | SearchResultMarket
  | SearchResultUser
  | SearchResultToken;

export type { SearchResponse, SearchResultMarket, SearchResultUser, SearchResultToken };

interface RecentSearch {
  query: string;
  timestamp: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RECENT_SEARCHES_KEY = "backit:recent_searches";
const MAX_RECENT_SEARCHES = 5;

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadRecentSearches(): RecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? (JSON.parse(raw) as RecentSearch[]) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(query: string): void {
  if (typeof window === "undefined" || !query.trim()) return;
  try {
    const existing = loadRecentSearches().filter(
      (r) => r.query.toLowerCase() !== query.toLowerCase()
    );
    const updated: RecentSearch[] = [
      { query: query.trim(), timestamp: Date.now() },
      ...existing,
    ].slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {
    // localStorage unavailable — silently ignore
  }
}

function removeRecentSearch(query: string): RecentSearch[] {
  const updated = loadRecentSearches().filter(
    (r) => r.query.toLowerCase() !== query.toLowerCase()
  );
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
  return updated;
}

function flattenResults(results: SearchResponse): SearchResult[] {
  return [
    ...results.markets,
    ...results.users,
    ...results.tokens,
  ];
}

function totalCount(results: SearchResponse): number {
  return (
    results.markets.length + results.users.length + results.tokens.length
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MarketResultItem({
  item,
  active,
  onSelect,
}: {
  item: SearchResultMarket;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
        active ? "bg-white/10" : "hover:bg-white/5"
      }`}
      aria-selected={active}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
        <TrendingUp className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">
          {item.title}
        </span>
        <span className="block truncate text-xs text-slate-400">
          {item.token} · {(item.totalStake / 1e7).toFixed(2)} XLM staked
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
    </button>
  );
}

function UserResultItem({
  item,
  active,
  onSelect,
}: {
  item: SearchResultUser;
  active: boolean;
  onSelect: () => void;
}) {
  const shortAddr = `${item.address.slice(0, 6)}…${item.address.slice(-4)}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
        active ? "bg-white/10" : "hover:bg-white/5"
      }`}
      aria-selected={active}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
        <User className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">
          {item.displayName ?? shortAddr}
        </span>
        <span className="block truncate text-xs text-slate-400">
          {item.winRate}% win rate · {item.totalCalls} calls
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
    </button>
  );
}

function TokenResultItem({
  item,
  active,
  onSelect,
}: {
  item: SearchResultToken;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
        active ? "bg-white/10" : "hover:bg-white/5"
      }`}
      aria-selected={active}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
        <Coins className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">
          {item.symbol}
          <span className="ml-1.5 text-xs font-normal text-slate-400">
            {item.name}
          </span>
        </span>
        {item.price !== undefined && (
          <span className="block text-xs text-slate-400">
            ${item.price.toFixed(4)}
          </span>
        )}
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
    </button>
  );
}

function SectionHeading({ label }: { label: string }) {
  return (
    <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
    </p>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface SearchBarProps {
  open: boolean;
  onClose: () => void;
}

export function SearchBar({ open, onClose }: SearchBarProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);

  // Load recent searches when modal opens
  useEffect(() => {
    if (open) {
      setRecentSearches(loadRecentSearches());
      setQuery("");
      setResults(null);
      setError(null);
      setActiveIndex(-1);
    }
  }, [open]);

  // ── Debounced search ────────────────────────────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSearch = useCallback(
    debounce(async (q: string) => {
      if (!q.trim()) {
        setResults(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await fetchSearch(q.trim());
        setResults(data);
        setActiveIndex(-1);
      } catch {
        setError("Search failed. Please try again.");
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 300),
    []
  );

  useEffect(() => {
    debouncedSearch(query);
    return () => debouncedSearch.cancel();
  }, [query, debouncedSearch]);

  // ── Flat list for keyboard navigation ──────────────────────────────────────

  const flatItems: SearchResult[] = results ? flattenResults(results) : [];

  // ── Navigation helpers ──────────────────────────────────────────────────────

  const navigateToResult = useCallback(
    (result: SearchResult) => {
      saveRecentSearch(query);
      setRecentSearches(loadRecentSearches());
      onClose();

      if (result.type === "market") {
        router.push(`/calls/${result.id}`);
      } else if (result.type === "user") {
        router.push(`/profile/${result.address}`);
      } else if (result.type === "token") {
        router.push(`/feed?token=${result.symbol}`);
      }
    },
    [query, onClose, router]
  );

  const navigateToRecentSearch = useCallback(
    (q: string) => {
      saveRecentSearch(q);
      setRecentSearches(loadRecentSearches());
      onClose();
      router.push(`/feed?q=${encodeURIComponent(q)}`);
    },
    [onClose, router]
  );

  // ── Keyboard handler ────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev: number) =>
          flatItems.length === 0 ? -1 : Math.min(prev + 1, flatItems.length - 1)
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev: number) => Math.max(prev - 1, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0 && flatItems[activeIndex]) {
          navigateToResult(flatItems[activeIndex]);
        } else if (query.trim()) {
          saveRecentSearch(query.trim());
          setRecentSearches(loadRecentSearches());
          onClose();
          router.push(`/feed?q=${encodeURIComponent(query.trim())}`);
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [flatItems, activeIndex, navigateToResult, query, onClose, router]
  );

  // ── Compute flat index offset per section ───────────────────────────────────

  const marketOffset = 0;
  const userOffset = results ? results.markets.length : 0;
  const tokenOffset = results
    ? results.markets.length + results.users.length
    : 0;

  const hasResults = results !== null && totalCount(results) > 0;
  const showEmpty =
    results !== null && totalCount(results) === 0 && !loading && query.trim();
  const showRecent = !query.trim() && recentSearches.length > 0;

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-50"
        onClose={onClose}
        initialFocus={inputRef}
      >
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            aria-hidden="true"
          />
        </Transition.Child>

        {/* Panel */}
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-start justify-center px-4 pt-[10vh]">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95 -translate-y-2"
              enterTo="opacity-100 scale-100 translate-y-0"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100 translate-y-0"
              leaveTo="opacity-0 scale-95 -translate-y-2"
            >
              <Dialog.Panel className="w-full max-w-xl transform overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl transition-all">
                {/* Search input row */}
                <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
                  {loading ? (
                    <Loader2
                      className="h-5 w-5 shrink-0 animate-spin text-slate-400"
                      aria-hidden="true"
                    />
                  ) : (
                    <Search
                      className="h-5 w-5 shrink-0 text-slate-400"
                      aria-hidden="true"
                    />
                  )}
                  <label htmlFor="global-search-input" className="sr-only">
                    Search markets, users, and tokens
                  </label>
                  <input
                    id="global-search-input"
                    ref={inputRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search markets, users, tokens…"
                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Search markets, users, and tokens"
                    aria-autocomplete="list"
                    aria-controls="search-results"
                    aria-activedescendant={
                      activeIndex >= 0
                        ? `search-result-${activeIndex}`
                        : undefined
                    }
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      aria-label="Clear search"
                      className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-white/5 hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <kbd className="hidden shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs text-slate-400 sm:block">
                    Esc
                  </kbd>
                </div>

                {/* Results area */}
                <div
                  id="search-results"
                  role="listbox"
                  aria-label="Search results"
                  className="max-h-[60vh] overflow-y-auto p-2"
                >
                  {/* Error state */}
                  {error && (
                    <p className="px-3 py-6 text-center text-sm text-red-400">
                      {error}
                    </p>
                  )}

                  {/* Empty state */}
                  {showEmpty && (
                    <div className="flex flex-col items-center gap-2 py-10 text-center">
                      <Search className="h-8 w-8 text-slate-600" aria-hidden="true" />
                      <p className="text-sm font-medium text-slate-300">
                        No results for &ldquo;{query}&rdquo;
                      </p>
                      <p className="text-xs text-slate-500">
                        Try a different keyword or browse the feed.
                      </p>
                    </div>
                  )}

                  {/* Recent searches */}
                  {showRecent && (
                    <div className="mb-2">
                      <div className="flex items-center justify-between px-3 pb-1">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Recent
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            localStorage.removeItem(RECENT_SEARCHES_KEY);
                            setRecentSearches([]);
                          }}
                          className="text-xs text-slate-500 transition hover:text-slate-300"
                        >
                          Clear all
                        </button>
                      </div>
                      {recentSearches.map((r) => (
                        <div
                          key={r.query}
                          className="group flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-white/5"
                        >
                          <Clock
                            className="h-4 w-4 shrink-0 text-slate-500"
                            aria-hidden="true"
                          />
                          <button
                            type="button"
                            onClick={() => navigateToRecentSearch(r.query)}
                            className="min-w-0 flex-1 truncate text-left text-sm text-slate-300 hover:text-white"
                          >
                            {r.query}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setRecentSearches(removeRecentSearch(r.query))
                            }
                            aria-label={`Remove "${r.query}" from recent searches`}
                            className="shrink-0 rounded-full p-0.5 text-slate-600 opacity-0 transition hover:text-slate-300 group-hover:opacity-100"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Grouped results */}
                  {hasResults && (
                    <div className="space-y-4">
                      {/* Markets */}
                      {results!.markets.length > 0 && (
                        <section aria-label="Markets">
                          <SectionHeading label="Markets" />
                          {results!.markets.map((item, i) => (
                            <MarketResultItem
                              key={item.id}
                              item={item}
                              active={activeIndex === marketOffset + i}
                              onSelect={() => navigateToResult(item)}
                            />
                          ))}
                        </section>
                      )}

                      {/* Users */}
                      {results!.users.length > 0 && (
                        <section aria-label="Users">
                          <SectionHeading label="Users" />
                          {results!.users.map((item, i) => (
                            <UserResultItem
                              key={item.address}
                              item={item}
                              active={activeIndex === userOffset + i}
                              onSelect={() => navigateToResult(item)}
                            />
                          ))}
                        </section>
                      )}

                      {/* Tokens */}
                      {results!.tokens.length > 0 && (
                        <section aria-label="Tokens">
                          <SectionHeading label="Tokens" />
                          {results!.tokens.map((item, i) => (
                            <TokenResultItem
                              key={item.address}
                              item={item}
                              active={activeIndex === tokenOffset + i}
                              onSelect={() => navigateToResult(item)}
                            />
                          ))}
                        </section>
                      )}
                    </div>
                  )}

                  {/* Idle hint */}
                  {!query.trim() && !showRecent && (
                    <p className="px-3 py-6 text-center text-sm text-slate-500">
                      Start typing to search markets, users, and tokens.
                    </p>
                  )}
                </div>

                {/* Footer hint */}
                <div className="flex items-center gap-4 border-t border-white/10 px-4 py-2.5 text-xs text-slate-500">
                  <span>
                    <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5">↑</kbd>
                    <kbd className="ml-1 rounded border border-white/10 bg-white/5 px-1 py-0.5">↓</kbd>
                    {" "}navigate
                  </span>
                  <span>
                    <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5">↵</kbd>
                    {" "}select
                  </span>
                  <span>
                    <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5">Esc</kbd>
                    {" "}close
                  </span>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
