"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, X, SlidersHorizontal, ChevronUp } from "lucide-react";

export type SortOption = "newest" | "ending_soon" | "most_staked" | "trending";
export type StatusFilter = "OPEN" | "RESOLVED" | null;

export interface FilterState {
  status: StatusFilter;
  sort: SortOption;
  token: string | null;
  minStake: number;
}

export const DEFAULT_FILTERS: FilterState = {
  status: null,
  sort: "newest",
  token: null,
  minStake: 0,
};

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "ending_soon", label: "Ending Soon" },
  { value: "most_staked", label: "Most Staked" },
  { value: "trending", label: "Trending" },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: null, label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "RESOLVED", label: "Resolved" },
];

// Fallback token list when no active-market tokens are available
const COMMON_TOKENS = [
  "XLM", "BTC", "ETH", "SOL", "USDC", "XRP", "ADA", "DOT",
];

const MIN_STAKE_MARKS = [0, 100, 500, 1000, 5000, 10000];

interface FilterBarProps {
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  /** Tokens derived from currently loaded markets — populates the dropdown */
  availableTokens?: string[];
}

export default function FilterBar({
  filters,
  onFilterChange,
  availableTokens,
}: FilterBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false);
  const tokenDropdownRef = useRef<HTMLDivElement>(null);

  // Close token dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        tokenDropdownRef.current &&
        !tokenDropdownRef.current.contains(e.target as Node)
      ) {
        setTokenDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const tokenList =
    availableTokens && availableTokens.length > 0
      ? availableTokens
      : COMMON_TOKENS;

  // Count non-default active filters
  const activeFilterCount = (
    [
      filters.status !== DEFAULT_FILTERS.status,
      filters.sort !== DEFAULT_FILTERS.sort,
      filters.token !== DEFAULT_FILTERS.token,
      filters.minStake !== DEFAULT_FILTERS.minStake,
    ] as boolean[]
  ).filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0;

  function update(partial: Partial<FilterState>) {
    onFilterChange({ ...filters, ...partial });
  }

  function clearAll() {
    onFilterChange({ ...DEFAULT_FILTERS });
  }

  return (
    <div className="mb-4" role="search" aria-label="Feed filters">
      {/* ── Always-visible top bar ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">

        {/* Status pills */}
        <div className="flex gap-1.5" role="group" aria-label="Filter by status">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => update({ status: opt.value })}
              aria-pressed={filters.status === opt.value}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                filters.status === opt.value
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Vertical divider — desktop only */}
        <div className="hidden sm:block w-px h-5 bg-gray-200" aria-hidden />

        {/* Sort pills — desktop only (mobile: inside panel) */}
        <div
          className="hidden sm:flex items-center gap-1.5"
          role="group"
          aria-label="Sort by"
        >
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update({ sort: opt.value })}
              aria-pressed={filters.sort === opt.value}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                filters.sort === opt.value
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Push remaining items to the right */}
        <div className="flex-1" />

        {/* Clear All — only shown when filters are active */}
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition-colors border border-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            aria-label={`Clear all ${activeFilterCount} active filter${activeFilterCount !== 1 ? "s" : ""}`}
          >
            <X className="w-3 h-3" aria-hidden />
            Clear All
            <span
              className="ml-0.5 bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold"
              aria-hidden
            >
              {activeFilterCount}
            </span>
          </button>
        )}

        {/* Advanced filters toggle — badge shows count when panel is closed */}
        <button
          onClick={() => setIsExpanded((v) => !v)}
          aria-expanded={isExpanded}
          aria-controls="filter-panel"
          aria-label={`Toggle advanced filters${hasActiveFilters && !isExpanded ? ` (${activeFilterCount} active)` : ""}`}
          className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            isExpanded
              ? "bg-indigo-50 text-indigo-700 border-indigo-200"
              : "bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200"
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden />
          <span className="hidden sm:inline">Filters</span>
          {isExpanded ? (
            <ChevronUp className="w-3 h-3" aria-hidden />
          ) : (
            <ChevronDown className="w-3 h-3" aria-hidden />
          )}
          {/* Badge on the button when panel is closed and filters are active */}
          {hasActiveFilters && !isExpanded && (
            <span
              className="absolute -top-1.5 -right-1.5 bg-indigo-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold"
              aria-hidden
            >
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Collapsible advanced panel ──────────────────────────────────── */}
      <div
        id="filter-panel"
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? "max-h-[600px] opacity-100 mt-3" : "max-h-0 opacity-0"
        }`}
        aria-hidden={!isExpanded}
      >
        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-5">

          {/* Sort — mobile only (desktop shows inline above) */}
          <div className="sm:hidden">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              Sort By
            </p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sort by">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => update({ sort: opt.value })}
                  aria-pressed={filters.sort === opt.value}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    filters.sort === opt.value
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Token filter */}
          <div>
            <p
              id="token-filter-label"
              className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2"
            >
              Token
            </p>
            <div className="relative" ref={tokenDropdownRef}>
              <button
                onClick={() => setTokenDropdownOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={tokenDropdownOpen}
                aria-labelledby="token-filter-label"
                className="flex items-center justify-between w-full sm:w-52 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-indigo-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <span>{filters.token ?? "All Tokens"}</span>
                <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden />
              </button>

              {tokenDropdownOpen && (
                <ul
                  role="listbox"
                  aria-labelledby="token-filter-label"
                  className="absolute z-20 mt-1 w-full sm:w-52 bg-white border border-gray-200 rounded-xl shadow-lg overflow-y-auto max-h-52"
                >
                  <li>
                    <button
                      role="option"
                      aria-selected={filters.token === null}
                      onClick={() => {
                        update({ token: null });
                        setTokenDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${
                        filters.token === null
                          ? "font-semibold text-indigo-600 bg-indigo-50"
                          : "text-gray-700"
                      }`}
                    >
                      All Tokens
                    </button>
                  </li>
                  {tokenList.map((tok) => (
                    <li key={tok}>
                      <button
                        role="option"
                        aria-selected={filters.token === tok}
                        onClick={() => {
                          update({ token: tok });
                          setTokenDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${
                          filters.token === tok
                            ? "font-semibold text-indigo-600 bg-indigo-50"
                            : "text-gray-700"
                        }`}
                      >
                        {tok}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Min pool size slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p
                id="stake-range-label"
                className="text-[10px] font-bold text-gray-400 uppercase tracking-wider"
              >
                Min Pool Size
              </p>
              <span className="text-xs font-semibold text-indigo-600">
                {filters.minStake === 0
                  ? "Any size"
                  : `≥ ${filters.minStake.toLocaleString()} XLM`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={10000}
              step={100}
              value={filters.minStake}
              onChange={(e) => update({ minStake: Number(e.target.value) })}
              aria-labelledby="stake-range-label"
              aria-valuemin={0}
              aria-valuemax={10000}
              aria-valuenow={filters.minStake}
              aria-valuetext={
                filters.minStake === 0
                  ? "Any size"
                  : `${filters.minStake.toLocaleString()} XLM minimum`
              }
              className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-indigo-600"
            />
            {/* Quick-select marks */}
            <div className="flex justify-between mt-1.5" aria-hidden>
              {MIN_STAKE_MARKS.map((mark) => (
                <button
                  key={mark}
                  tabIndex={-1}
                  onClick={() => update({ minStake: mark })}
                  className={`text-[10px] font-medium transition-colors ${
                    filters.minStake === mark
                      ? "text-indigo-600 font-bold"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {mark === 0
                    ? "Any"
                    : mark >= 1000
                    ? `${mark / 1000}k`
                    : mark}
                </button>
              ))}
            </div>
          </div>

          {/* Footer: active filter summary + clear */}
          {hasActiveFilters && (
            <div className="flex items-center justify-between pt-3 border-t border-gray-200">
              <span className="text-xs text-gray-500">
                {activeFilterCount} active filter
                {activeFilterCount !== 1 ? "s" : ""}
              </span>
              <button
                onClick={clearAll}
                className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded"
              >
                Clear All Filters
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
