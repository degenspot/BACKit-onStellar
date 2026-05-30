"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useWalletContext } from "@/components/WalletContext";
import LeaderboardSkeleton from "@/components/skeletons/LeaderboardSkeleton";

type Period = "weekly" | "monthly" | "all-time";

type LeaderboardRow = {
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  winRate: number;
  totalProfit: number;
  reputationScore: number;
};

const periodTabs: Array<{ id: Period; label: string }> = [
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "all-time", label: "All-Time" },
];

function medalStyle(rank: number) {
  if (rank === 1) return "bg-amber-100 text-amber-800 border-amber-300";
  if (rank === 2) return "bg-slate-100 text-slate-700 border-slate-300";
  if (rank === 3) return "bg-orange-100 text-orange-800 border-orange-300";
  return "bg-white text-gray-600 border-gray-200";
}

export default function LeaderboardPage() {
  const { publicKey } = useWalletContext();
  const [period, setPeriod] = useState<Period>("weekly");
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch(`/api/leaderboard?period=${period}`)
      .then((res) => res.json())
      .then((json) => {
        if (!mounted) return;
        setRows(Array.isArray(json?.data) ? json.data : []);
      })
      .catch(() => {
        if (!mounted) return;
        setRows([]);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [period]);

  const highlightedUser = useMemo(() => publicKey ?? "", [publicKey]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-gray-900">Leaderboard</h1>
        <p className="text-sm text-gray-600">Top predictors by win rate, profit, and reputation.</p>
      </div>

      <div className="mb-6 flex w-fit gap-2 rounded-2xl border border-gray-200 bg-white p-1">
        {periodTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setPeriod(tab.id)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              period === tab.id ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LeaderboardSkeleton />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-gray-600">
          No leaderboard entries yet.
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 md:block">
            <table className="min-w-full bg-white text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Win Rate</th>
                  <th className="px-4 py-3">Total Profit</th>
                  <th className="px-4 py-3">Reputation Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.userId}
                    className={`border-t ${
                      highlightedUser && row.userId === highlightedUser ? "bg-green-50" : "bg-white"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${medalStyle(row.rank)}`}>
                        #{row.rank}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/profile/${row.userId}`} className="font-semibold text-gray-900 hover:underline">
                        {row.username}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{row.winRate.toFixed(1)}%</td>
                    <td className="px-4 py-3">${row.totalProfit.toLocaleString()}</td>
                    <td className="px-4 py-3">{row.reputationScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {rows.map((row) => (
              <Link
                href={`/profile/${row.userId}`}
                key={row.userId}
                className={`block rounded-xl border p-4 ${
                  highlightedUser && row.userId === highlightedUser
                    ? "border-green-300 bg-green-50"
                    : "border-gray-200 bg-white"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${medalStyle(row.rank)}`}>
                    #{row.rank}
                  </span>
                  <span className="text-xs text-gray-500">{row.winRate.toFixed(1)}% win rate</span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{row.username}</p>
                <p className="mt-1 text-xs text-gray-600">Profit: ${row.totalProfit.toLocaleString()}</p>
                <p className="text-xs text-gray-600">Reputation: {row.reputationScore.toFixed(1)}</p>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
