import { UserProfile } from "@/types";

/**
 * Development-only profile fixtures.
 *
 * Scope: the profile and follower mock routes under `src/app/api/users` only.
 * Market detail, odds, recent stakes, portfolio stakes and payout claims come
 * from the NestJS backend through `@/lib/backend` and must never read from
 * this module. Do not import it from a component or any production data path.
 */

const globalForFixtures = global as unknown as {
  mockUsers: Record<string, UserProfile>;
};

if (!globalForFixtures.mockUsers) {
  globalForFixtures.mockUsers = {
    GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ: {
      user: {
        address: "GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
        displayName: "Alice Trader",
        winRate: 0.75,
        totalCalls: 24,
        followers: 156,
        following: 42,
        isFollowing: false,
        bio: "Crypto analyst and top prediction maker on Stellar. Seeking alpha daily.",
        avatarUrl: null,
        badges: [
          {
            type: "Early Adopter",
            earnedAt: new Date(Date.now() - 86400 * 30 * 1000).toISOString(),
          },
          {
            type: "Top Predictor",
            earnedAt: new Date(Date.now() - 86400 * 12 * 1000).toISOString(),
          },
          {
            type: "Hot Streak",
            earnedAt: new Date(Date.now() - 86400 * 3 * 1000).toISOString(),
          },
        ],
      },
      createdCalls: [
        {
          id: "1",
          creator: "GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
          title: "BTC will hit $50k by end of month",
          description: "Bitcoin price prediction based on market analysis",
          token: "BTC",
          condition: "price > 50000",
          stake: 100,
          startTs: Date.now() / 1000 - 86400,
          endTs: Date.now() / 1000 + 86400 * 7,
          outcome: "PENDING",
          participants: 12,
          totalStake: 1200,
        },
        {
          id: "2",
          creator: "GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
          title: "ETH 2.0 adoption will increase 30%",
          description: "Ethereum network upgrade adoption prediction",
          token: "ETH",
          condition: "adoption_rate > 0.3",
          stake: 50,
          startTs: Date.now() / 1000 - 172800,
          endTs: Date.now() / 1000 - 86400,
          outcome: "YES",
          finalPrice: 2500,
          participants: 8,
          totalStake: 400,
        },
      ],
      participatedCalls: [
        {
          id: "3",
          creator: "GD3DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
          title: "SOL will break $100 resistance",
          description: "Solana price technical analysis",
          token: "SOL",
          condition: "price > 100",
          stake: 75,
          startTs: Date.now() / 1000 - 43200,
          endTs: Date.now() / 1000 + 43200,
          outcome: "PENDING",
          participants: 15,
          totalStake: 1125,
        },
      ],
      resolvedCalls: [
        {
          id: "2",
          creator: "GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ",
          title: "ETH 2.0 adoption will increase 30%",
          description: "Ethereum network upgrade adoption prediction",
          token: "ETH",
          condition: "adoption_rate > 0.3",
          stake: 50,
          startTs: Date.now() / 1000 - 172800,
          endTs: Date.now() / 1000 - 86400,
          outcome: "YES",
          finalPrice: 2500,
          participants: 8,
          totalStake: 400,
        },
      ],
    },
  };
}

export const mockUsers = globalForFixtures.mockUsers;

export function getUserProfile(address: string): UserProfile {
  if (!mockUsers[address]) {
    mockUsers[address] = {
      user: {
        address,
        displayName: "",
        winRate: 0,
        totalCalls: 0,
        followers: 0,
        following: 0,
        isFollowing: false,
        bio: "",
        avatarUrl: null,
        badges: [],
      },
      createdCalls: [],
      participatedCalls: [],
      resolvedCalls: [],
    };
  }
  return mockUsers[address];
}

export function updateUserProfile(
  address: string,
  updates: { displayName?: string; bio?: string; avatarUrl?: string | null },
): UserProfile {
  const profile = getUserProfile(address);
  if (updates.displayName !== undefined)
    profile.user.displayName = updates.displayName;
  if (updates.bio !== undefined) profile.user.bio = updates.bio;
  if (updates.avatarUrl !== undefined)
    profile.user.avatarUrl = updates.avatarUrl;
  return profile;
}
