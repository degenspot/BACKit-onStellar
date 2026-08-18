export interface User {
  address: string;
  displayName?: string;
  winRate: number;
  totalCalls: number;
  followers: number;
  following: number;
  isFollowing?: boolean;
  bio?: string;
  avatarUrl?: string | null;
  badges?: UserBadge[];
}

export type BadgeType =
  | "Early Adopter"
  | "Top Predictor"
  | "Whale"
  | "Hot Streak"
  | "Community Leader";

export interface UserBadge {
  type: BadgeType;
  earnedAt?: string;
}

export interface Call {
  id: string;
  creator: string;
  title: string;
  description: string;
  token: string;
  condition: string;
  stake: number;
  startTs: number;
  endTs: number;
  outcome?: "YES" | "NO" | "PENDING";
  finalPrice?: number;
  participants: number;
  totalStake: number;
  contentCID?: string;
}

export interface UserProfile {
  user: User;
  createdCalls: Call[];
  participatedCalls: Call[];
  resolvedCalls: Call[];
}

/**
 * Market detail, stake-ledger and portfolio types now live with their typed
 * backend clients in `@/lib/backend` (see `markets.ts` and `portfolio.ts`),
 * where monetary values are carried as stroops instead of floats.
 */

export type TabType =
  | "created"
  | "participated"
  | "resolved"
  | "followers"
  | "following"
  | "my-markets";
