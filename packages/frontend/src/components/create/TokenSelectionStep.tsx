"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { StepErrors, TokenPair } from "./types";

const TOKEN_PAIRS: TokenPair[] = [
  {
    symbol: "BTC/USD",
    name: "Bitcoin",
    base: "BTC",
    quote: "USD",
    price: 67420,
    change24h: 2.3,
  },
  {
    symbol: "ETH/USD",
    name: "Ethereum",
    base: "ETH",
    quote: "USD",
    price: 3840,
    change24h: 1.8,
  },
  {
    symbol: "XLM/USD",
    name: "Stellar Lumens",
    base: "XLM",
    quote: "USD",
    price: 0.42,
    change24h: 5.1,
  },
  {
    symbol: "SOL/USD",
    name: "Solana",
    base: "SOL",
    quote: "USD",
    price: 182,
    change24h: -0.5,
  },
  {
    symbol: "AVAX/USD",
    name: "Avalanche",
    base: "AVAX",
    quote: "USD",
    price: 41.2,
    change24h: 3.2,
  },
  {
    symbol: "USDC/XLM",
    name: "USD Coin against Stellar",
    base: "USDC",
    quote: "XLM",
    price: 2.38,
    change24h: -1.1,
  },
];

function formatPrice(price: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: price < 1 ? 4 : 2,
  }).format(price);
}

export default function TokenSelectionStep({
  selected,
  onSelect,
  errors,
}: {
  selected: TokenPair | null;
  onSelect: (token: TokenPair) => void;
  errors: StepErrors;
}) {
  const [query, setQuery] = useState("");

  const filteredPairs = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return TOKEN_PAIRS;

    return TOKEN_PAIRS.filter((pair) => {
      return (
        pair.symbol.toLowerCase().includes(normalized) ||
        pair.name.toLowerCase().includes(normalized) ||
        pair.base.toLowerCase().includes(normalized) ||
        pair.quote.toLowerCase().includes(normalized)
      );
    });
  }, [query]);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-gray-950">Token Selection</h2>
        <p className="mt-1 text-sm text-gray-600">
          Pick the market pair your prediction will settle against.
        </p>
      </div>

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-gray-800">
          Search pair
        </span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full rounded-lg border border-gray-300 bg-white py-3 pl-10 pr-3 text-gray-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            placeholder="BTC, XLM, ETH/USD"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </label>

      {errors.tokenPair && (
        <p className="text-sm font-medium text-red-600">{errors.tokenPair}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {filteredPairs.map((pair) => {
          const active = selected?.symbol === pair.symbol;

          return (
            <button
              key={pair.symbol}
              type="button"
              onClick={() => onSelect(pair)}
              className={[
                "rounded-lg border p-4 text-left transition hover:border-indigo-300 hover:bg-indigo-50",
                active
                  ? "border-indigo-600 bg-indigo-50 ring-2 ring-indigo-100"
                  : "border-gray-200 bg-white",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-gray-950">{pair.symbol}</div>
                  <div className="mt-1 text-sm text-gray-600">{pair.name}</div>
                </div>
                <span
                  className={[
                    "rounded-md px-2 py-1 text-xs font-bold",
                    pair.change24h >= 0
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700",
                  ].join(" ")}
                >
                  {pair.change24h >= 0 ? "+" : ""}
                  {pair.change24h}%
                </span>
              </div>
              <div className="mt-4 text-sm text-gray-500">
                Last price{" "}
                <span className="font-semibold text-gray-900">
                  {formatPrice(pair.price)} {pair.quote}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
