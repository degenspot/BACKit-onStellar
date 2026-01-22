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
