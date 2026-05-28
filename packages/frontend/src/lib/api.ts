export async function searchTokens(query: string) {
  if (!query) return [];

  const res = await fetch(`/api/tokens?search=${query}`);
  if (!res.ok) throw new Error("Failed to fetch tokens");

  return res.json();
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export async function fetchFeed(
  type: "for-you" | "following",
  cursor?: string,
  filters?: { status?: string | null; sort?: string; token?: string | null; minStake?: number }
) {
  const params = new URLSearchParams();
  params.set("type", type);
  if (cursor) params.set("cursor", cursor);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.sort) params.set("sort", filters.sort);
  if (filters?.token && filters.token !== "ALL") params.set("token", filters.token);
  if (typeof filters?.minStake === "number" && filters.minStake > 0) {
    params.set("minStake", String(filters.minStake));
  }

  let res = await fetch(`/api/feed?${params.toString()}`);

  if (!res.ok) {
    res = await fetch(`${BACKEND_URL}/calls/feed?${params.toString()}`);
  }

  if (!res.ok) {
    throw new Error("Failed to fetch feed");
  }

  const payload = await res.json();

  if (Array.isArray(payload)) {
    return { items: payload, nextCursor: null };
  }

  return {
    items: payload.items ?? payload.data ?? payload.calls ?? [],
    nextCursor: payload.nextCursor ?? payload.cursor ?? null,
    ...payload,
  };
}

// ── Notifications ──────────────────────────────────────────────────────────

export interface Notification {
  id: number;
  userId: string;
  type: "BACKED_CALL" | "CALL_ENDED" | "PAYOUT_READY" | "NEW_FOLLOWER";
  referenceId?: string;
  message: string;
  readStatus: boolean;
  createdAt: string;
}

export interface NotificationsResponse {
  data: Notification[];
  totalCount: number;
  hasNext: boolean;
  unreadCount: number;
}

export async function fetchNotifications(
  userId: string,
  limit = 20,
  offset = 0
): Promise<NotificationsResponse> {
  const params = new URLSearchParams({
    userId,
    limit: String(limit),
    offset: String(offset),
  });
  const res = await fetch(`${BACKEND_URL}/notifications?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch notifications");
  return res.json();
}

export async function markNotificationsRead(
  userId: string,
  ids?: number[]
): Promise<{ updated: number }> {
  const params = new URLSearchParams({ userId });
  const res = await fetch(
    `${BACKEND_URL}/notifications/mark-read?${params.toString()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { ids } : {}),
    }
  );
  if (!res.ok) throw new Error("Failed to mark notifications as read");
  return res.json();
}
