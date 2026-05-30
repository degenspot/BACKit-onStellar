import { NextRequest, NextResponse } from "next/server";

type Period = "weekly" | "monthly" | "all-time";

const baseRows = [
  { userId: "GATOPTRADER111", username: "Alpha Oracle", avatarUrl: null, winRate: 78.2, totalProfit: 12450.55, reputationScore: 94.2 },
  { userId: "GATOPTRADER222", username: "Macro Maven", avatarUrl: null, winRate: 73.4, totalProfit: 9821.2, reputationScore: 88.1 },
  { userId: "GATOPTRADER333", username: "Chain Seer", avatarUrl: null, winRate: 70.8, totalProfit: 8450.35, reputationScore: 84.6 },
  { userId: "GATOPTRADER444", username: "Vol Hunter", avatarUrl: null, winRate: 67.2, totalProfit: 6712.12, reputationScore: 79.4 },
  { userId: "GATOPTRADER555", username: "Delta Pilot", avatarUrl: null, winRate: 64.9, totalProfit: 5010.8, reputationScore: 75.2 },
];

function scaleByPeriod(rows: typeof baseRows, period: Period) {
  if (period === "weekly") return rows.map((r) => ({ ...r, totalProfit: Number((r.totalProfit * 0.18).toFixed(2)) }));
  if (period === "monthly") return rows.map((r) => ({ ...r, totalProfit: Number((r.totalProfit * 0.62).toFixed(2)) }));
  return rows;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get("period") as Period | null) ?? "all-time";
  const rows = scaleByPeriod(baseRows, period).map((row, index) => ({
    rank: index + 1,
    ...row,
  }));

  return NextResponse.json({ data: rows });
}
