import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * GET /api/feed
 *
 * Proxies feed requests to the NestJS backend, forwarding all filter/sort
 * query parameters:
 *   - type:     "for-you" | "following"
 *   - cursor:   pagination cursor (optional)
 *   - status:   "OPEN" | "RESOLVED" (optional)
 *   - sort:     "newest" | "ending_soon" | "most_staked" | "trending"
 *   - token:    token symbol filter (optional)
 *   - minStake: minimum total pool size (optional)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const type = searchParams.get("type") ?? "for-you";
  const cursor = searchParams.get("cursor");
  const status = searchParams.get("status");
  const sort = searchParams.get("sort") ?? "newest";
  const token = searchParams.get("token");
  const minStake = searchParams.get("minStake");

  // Map frontend sort values to backend sort values
  const backendSort = sort === "trending" ? "trending" : "recent";

  // Build backend query params
  const params = new URLSearchParams();

  // Page / cursor — backend uses page-based pagination; derive page from cursor
  if (cursor) {
    params.set("page", cursor);
  } else {
    params.set("page", "1");
  }
  params.set("limit", "20");
  params.set("sort", backendSort);

  // Determine which backend endpoint to call
  let endpoint: string;
  if (type === "following") {
    endpoint = `${BACKEND_URL}/calls/feed/following`;
    // Following feed requires an address — passed via a separate header or
    // query param by the client; forward it if present
    const address = searchParams.get("address");
    if (address) params.set("address", address);
  } else {
    endpoint = `${BACKEND_URL}/calls/feed`;
  }

  try {
    const res = await fetch(`${endpoint}?${params.toString()}`, {
      headers: { "Content-Type": "application/json" },
      // Don't cache on the Next.js layer — let the backend handle caching
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Backend request failed", status: res.status },
        { status: res.status }
      );
    }

    const backendData = await res.json();

    // backendData shape: { data: Call[], total: number, page: number, limit: number }
    let items: any[] = backendData.data ?? [];

    // ── Client-side filtering for params the backend doesn't yet support ──

    // Filter by status
    if (status) {
      const resolvedStatuses = ["RESOLVED_YES", "RESOLVED_NO", "SETTLING"];
      if (status === "OPEN") {
        items = items.filter((c: any) => c.status === "OPEN");
      } else if (status === "RESOLVED") {
        items = items.filter((c: any) => resolvedStatuses.includes(c.status));
      }
    }

    // Filter by token symbol
    if (token) {
      items = items.filter(
        (c: any) =>
          c.token === token ||
          c.tokenAddress === token ||
          c.stakeToken === token ||
          (c.conditionJson?.token &&
            c.conditionJson.token.toUpperCase() === token.toUpperCase())
      );
    }

    // Filter by minimum pool size
    if (minStake) {
      const min = parseFloat(minStake);
      if (!isNaN(min) && min > 0) {
        items = items.filter((c: any) => {
          const yes = parseFloat(c.totalYesStake ?? c.stakes?.yes ?? 0);
          const no = parseFloat(c.totalNoStake ?? c.stakes?.no ?? 0);
          return yes + no >= min;
        });
      }
    }

    // ── Client-side sorting for params the backend doesn't yet support ──
    if (sort === "ending_soon") {
      items = [...items].sort((a, b) => {
        const aEnd = new Date(a.endTs ?? a.endTime ?? 0).getTime();
        const bEnd = new Date(b.endTs ?? b.endTime ?? 0).getTime();
        return aEnd - bEnd;
      });
    } else if (sort === "most_staked") {
      items = [...items].sort((a, b) => {
        const aPool =
          parseFloat(a.totalYesStake ?? 0) + parseFloat(a.totalNoStake ?? 0);
        const bPool =
          parseFloat(b.totalYesStake ?? 0) + parseFloat(b.totalNoStake ?? 0);
        return bPool - aPool;
      });
    }

    // Determine next cursor (next page number as string)
    const { page, limit, total } = backendData;
    const currentPage = Number(page ?? 1);
    const pageLimit = Number(limit ?? 20);
    const hasMore = currentPage * pageLimit < Number(total ?? 0);
    const nextCursor = hasMore ? String(currentPage + 1) : null;

    return NextResponse.json({ items, nextCursor, total });
  } catch (err) {
    console.error("[/api/feed] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
