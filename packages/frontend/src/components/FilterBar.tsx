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

// Common tokens on Stellar / prediction markets
const COMMON_TOKENS = ["XLM", "BTC", "ETH", "SOL", "USDC", "XRP", "ADA", "DOT"];

const MIN_STAKE_MARKS = [0, 100, 500, 1000, 5000, 10000];

interface FilterBarProps {
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  /** Optional list of tokens from active markets to populate the dropdown */
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

  // Count active (non-default) filters
  const activeFilterCount = [
    filters.status !== DEFAULT_FILTERS.status,
    filters.sort !== DEFAULT_FILTERS.sort,
    filters.token !== DEFAULT_FILTERS.token,
    filters.minStake !== DEFAULT_FILTERS.minStake,
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0;

  function update(partial: Partial<FilterState>) {
    onFilterChange({ ...filters, ...partial });
  }

  function clearAll() {
    onFilterChange({ ...DEFAULT_FILTERS });
  }

  return (
    <div className="mb-4">
      {/* ── Top bar: always visible ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Status pills */}
        <div className="flex gap-1.5">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => update({ status: opt.value })}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                filters.status === opt.value
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="hidden sm:block w-px h-5 bg-gray-200" />

        {/* Sort — visible on desktop, hidden on mobile (inside panel) */}
        <div className="hidden sm:flex items-center gap-1.5">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => update({ sort: opt.value })}
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

        {/* Spacer */}
        <div className="flex-1" />

        {/* Active filter badge + clear */}
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition-colors border border-red-200"
          >
            <X className="w-3 h-3" />
            Clear All
            <span className="ml-0.5 bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold">
              {activeFilterCount}
            </span>
          </button>
        )}

        {/* Advanced filters toggle */}
        <button
          onClick={() => setIsExpanded((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
            isExpanded
              ? "bg-indigo-50 text-indigo-700 border-indigo-200"
              : "bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200"
          }`}
          aria-expanded={isExpanded}
          aria-label="Toggle advanced filters"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Filters</span>
          {isExpanded ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>
      </div>

      {/* ── Collapsible advanced panel ──────────────────────────────────── */}
      {isExpanded && (
        <div className="mt-3 p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-4">
          {/* Sort — mobile only (desktop shows inline above) */}
          <div className="sm:hidden">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              Sort By
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => update({ sort: opt.value })}
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
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              Token
            </p>
            <div className="relative" ref={tokenDropdownRef}>
              <button
                onClick={() => setTokenDropdownOpen((v) => !v)}
                className="flex items-center justify-between w-full sm:w-48 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:border-indigo-300 transition-colors"
              >
                <span>{filters.token ?? "All Tokens"}</span>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>

              {tokenDropdownOpen && (
                <div className="absolute z-20 mt-1 w-full sm:w-48 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  <button
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
                  {tokenList.map((tok) => (
                    <button
                      key={tok}
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
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Min stake range */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Min Pool Size
              </p>
              <span className="text-xs font-semibold text-indigo-600">
                {filters.minStake === 0
                  ? "Any"
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
              className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-indigo-600"
              aria-label="Minimum pool size"
            />
            <div className="flex justify-between mt-1">
              {MIN_STAKE_MARKS.map((mark) => (
                <button
                  key={mark}
                  onClick={() => update({ minStake: mark })}
                  className={`text-[10px] font-medium transition-colors ${
                    filters.minStake === mark
                      ? "text-indigo-600 font-bold"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {mark === 0 ? "Any" : mark >= 1000 ? `${mark / 1000}k` : mark}
                </button>
              ))}
            </div>
          </div>

          {/* Active filter summary */}
          {hasActiveFilters && (
            <div className="flex items-center justify-between pt-2 border-t border-gray-200">
              <span className="text-xs text-gray-500">
                {activeFilterCount} active filter{activeFilterCount !== 1 ? "s" : ""}
              </span>
              <button
                onClick={clearAll}
                className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors"
              >
                Clear All Filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
