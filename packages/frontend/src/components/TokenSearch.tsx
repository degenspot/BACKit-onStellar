"use client";

import { useEffect, useState } from "react";
import debounce from "lodash.debounce";
import { searchTokens } from "@/lib/api";

type Token = {
  symbol: string;
  name: string;
};

export default function TokenSearch({
  onSelect,
}: {
  onSelect: (token: Token) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTokens = debounce(async (q: string) => {
    setLoading(true);
    try {
      const data = await searchTokens(q);
      setResults(data);
    } finally {
      setLoading(false);
    }
  }, 400);

  useEffect(() => {
    if (query.length > 1) fetchTokens(query);
  }, [query]);

  return (
    <div>
      <input
        className="w-full border p-2"
        placeholder="Search token (e.g BTC)"
        onChange={(e) => setQuery(e.target.value)}
      />

      {loading && <p className="text-sm mt-1">Searching…</p>}

      <ul className="border mt-2">
        {results.map((token) => (
          <li
            key={token.symbol}
            className="p-2 hover:bg-gray-100 cursor-pointer"
            onClick={() => onSelect(token)}
          >
            {token.symbol} — {token.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
