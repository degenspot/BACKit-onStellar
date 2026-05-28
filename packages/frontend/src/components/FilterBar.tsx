import { useState } from "react";

export type SortOption = "newest" | "ending-soon" | "most-staked" | "trending";
export interface FeedFilters {
  status: "ALL" | "OPEN" | "RESOLVED";
  sort: SortOption;
  token: string;
  minStake: number;
}

interface FilterBarProps {
  filters: FeedFilters;
  availableTokens: string[];
  activeFilterCount: number;
  onFilterChange: (filters: FeedFilters) => void;
  onClearFilters: () => void;
}

const sortOptions: Array<{ value: SortOption; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "ending-soon", label: "Ending Soon" },
  { value: "most-staked", label: "Most Staked" },
  { value: "trending", label: "Trending" },
];

const statusOptions: Array<FeedFilters["status"]> = ["ALL", "OPEN", "RESOLVED"];

export default function FilterBar({
  filters,
  availableTokens,
  activeFilterCount,
  onFilterChange,
  onClearFilters,
}: FilterBarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const updateFilters = (patch: Partial<FeedFilters>) => {
    onFilterChange({ ...filters, ...patch });
  };

  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
        <div>
          <p className="text-sm font-semibold text-gray-900">Filters & Sort</p>
          <p className="text-xs text-gray-500">Refine what appears in your feed.</p>
        </div>
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white">
              {activeFilterCount} active
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 md:hidden"
          >
            {isOpen ? "Hide" : "Show"} filters
          </button>
        </div>
      </div>

      <div className={`${isOpen ? "block" : "hidden md:block"}`}>
        <div className="grid gap-5 px-4 py-4 sm:px-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Sort</p>
              <div className="flex flex-wrap gap-2">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateFilters({ sort: option.value })}
                    className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                      filters.sort === option.value
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Status</p>
              <div className="flex flex-wrap gap-2">
                {statusOptions.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => updateFilters({ status })}
                    className={`rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                      filters.status === status
                        ? "bg-emerald-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {status === "ALL" ? "All" : status === "OPEN" ? "Open" : "Resolved"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
              Token
              <select
                value={filters.token}
                onChange={(event) => updateFilters({ token: event.target.value })}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none ring-0 transition focus:border-blue-500 focus:bg-white"
              >
                <option value="ALL">All tokens</option>
                {availableTokens.map((token) => (
                  <option key={token} value={token}>{token}</option>
                ))}
              </select>
            </label>

            <div>
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                <span>Minimum pool size</span>
                <span className="text-gray-700">{filters.minStake} USDC</span>
              </div>
              <input
                type="range"
                min="0"
                max="1000"
                step="50"
                value={filters.minStake}
                onChange={(event) => updateFilters({ minStake: Number(event.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onClearFilters}
                className="rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Clear All Filters
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}