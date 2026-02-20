export async function searchTokens(query: string) {
  if (!query) return [];

  const res = await fetch(`/api/tokens?search=${query}`);
  if (!res.ok) throw new Error("Failed to fetch tokens");

  return res.json();
}

export async function fetchFeed(
  type: "for-you" | "following",
  cursor?: string
) {
  const params = new URLSearchParams();
  params.set("type", type);
  if (cursor) params.set("cursor", cursor);

  const res = await fetch(`/api/feed?${params.toString()}`);

  if (!res.ok) {
    throw new Error("Failed to fetch feed");
  }

  return res.json();
}

// ── Notifications ──────────────────────────────────────────────────────────

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

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
