import { UserProfile } from "@/types";

export interface MockStake {
  id: string;
  callId: string;
  userAddress: string;
  amount: number;
  position: 'YES' | 'NO';
  profitLoss: number | null;
  transactionHash: string | null;
  createdAt: string;
  updatedAt: string;
  resolutionStatus: 'PENDING' | 'RESOLVED';
  claimed: boolean;
  call: {
    id: string;
    title: string;
    description: string;
    outcome: 'YES' | 'NO' | 'PENDING';
    resolvedAt?: string | null;
    expiresAt?: string | null;
    createdAt: string;
    contractAddress?: string | null;
    totalYesStake: number;
    totalNoStake: number;
  };
}

// Keep mockUsers and mockStakes in global storage to persist across hot reloads in Next.js development mode
const globalForMockDb = global as unknown as {
  mockUsers: Record<string, UserProfile>;
  mockStakes: MockStake[];
};

if (!globalForMockDb.mockUsers) {
  globalForMockDb.mockUsers = {
    'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ': {
      user: {
        address: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
        displayName: 'Alice Trader',
        winRate: 0.75,
        totalCalls: 24,
        followers: 156,
        following: 42,
        isFollowing: false,
        bio: 'Crypto analyst and top prediction maker on Stellar. Seeking alpha daily.',
        avatarUrl: null
      },
      createdCalls: [
        {
          id: '1',
          creator: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
          title: 'BTC will hit $50k by end of month',
          description: 'Bitcoin price prediction based on market analysis',
          token: 'BTC',
          condition: 'price > 50000',
          stake: 100,
          startTs: Date.now() / 1000 - 86400,
          endTs: Date.now() / 1000 + 86400 * 7,
          outcome: 'PENDING',
          participants: 12,
          totalStake: 1200
        },
        {
          id: '2',
          creator: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
          title: 'ETH 2.0 adoption will increase 30%',
          description: 'Ethereum network upgrade adoption prediction',
          token: 'ETH',
          condition: 'adoption_rate > 0.3',
          stake: 50,
          startTs: Date.now() / 1000 - 172800,
          endTs: Date.now() / 1000 - 86400,
          outcome: 'YES',
          finalPrice: 2500,
          participants: 8,
          totalStake: 400
        }
      ],
      participatedCalls: [
        {
          id: '3',
          creator: 'GD3DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
          title: 'SOL will break $100 resistance',
          description: 'Solana price technical analysis',
          token: 'SOL',
          condition: 'price > 100',
          stake: 75,
          startTs: Date.now() / 1000 - 43200,
          endTs: Date.now() / 1000 + 43200,
          outcome: 'PENDING',
          participants: 15,
          totalStake: 1125
        }
      ],
      resolvedCalls: [
        {
          id: '2',
          creator: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
          title: 'ETH 2.0 adoption will increase 30%',
          description: 'Ethereum network upgrade adoption prediction',
          token: 'ETH',
          condition: 'adoption_rate > 0.3',
          stake: 50,
          startTs: Date.now() / 1000 - 172800,
          endTs: Date.now() / 1000 - 86400,
          outcome: 'YES',
          finalPrice: 2500,
          participants: 8,
          totalStake: 400
        }
      ]
    }
  };
}

export const mockUsers = globalForMockDb.mockUsers;

export function getUserProfile(address: string): UserProfile {
  if (!mockUsers[address]) {
    mockUsers[address] = {
      user: {
        address,
        displayName: '',
        winRate: 0,
        totalCalls: 0,
        followers: 0,
        following: 0,
        isFollowing: false,
        bio: '',
        avatarUrl: null
      },
      createdCalls: [],
      participatedCalls: [],
      resolvedCalls: []
    };
  }
  return mockUsers[address];
}

export function updateUserProfile(
  address: string, 
  updates: { displayName?: string; bio?: string; avatarUrl?: string | null }
): UserProfile {
  const profile = getUserProfile(address);
  if (updates.displayName !== undefined) profile.user.displayName = updates.displayName;
  if (updates.bio !== undefined) profile.user.bio = updates.bio;
  if (updates.avatarUrl !== undefined) profile.user.avatarUrl = updates.avatarUrl;
  return profile;
}

if (!globalForMockDb.mockStakes) {
  globalForMockDb.mockStakes = [
    {
      id: 'stake-1',
      callId: '1',
      userAddress: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
      amount: 100,
      position: 'YES',
      profitLoss: null,
      transactionHash: 'tx_hash_1',
      createdAt: new Date(Date.now() - 86400 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 86400 * 1000).toISOString(),
      resolutionStatus: 'PENDING',
      claimed: false,
      call: {
        id: '1',
        title: 'BTC will hit $50k by end of month',
        description: 'Bitcoin price prediction based on market analysis',
        outcome: 'PENDING',
        expiresAt: new Date(Date.now() + 86400 * 5 * 1000).toISOString(),
        createdAt: new Date(Date.now() - 86400 * 2 * 1000).toISOString(),
        contractAddress: 'CC_BTC_50K',
        totalYesStake: 1200,
        totalNoStake: 800,
      }
    },
    {
      id: 'stake-2',
      callId: '2',
      userAddress: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
      amount: 50,
      position: 'YES',
      profitLoss: 75,
      transactionHash: 'tx_hash_2',
      createdAt: new Date(Date.now() - 86400 * 3 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 86400 * 2 * 1000).toISOString(),
      resolutionStatus: 'RESOLVED',
      claimed: false,
      call: {
        id: '2',
        title: 'ETH 2.0 adoption will increase 30%',
        description: 'Ethereum network upgrade adoption prediction',
        outcome: 'YES',
        resolvedAt: new Date(Date.now() - 86400 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 86400 * 1000).toISOString(),
        createdAt: new Date(Date.now() - 86400 * 4 * 1000).toISOString(),
        contractAddress: 'CC_ETH_30',
        totalYesStake: 400,
        totalNoStake: 600,
      }
    },
    {
      id: 'stake-3',
      callId: '3',
      userAddress: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
      amount: 75,
      position: 'NO',
      profitLoss: 112.5,
      transactionHash: 'tx_hash_3',
      createdAt: new Date(Date.now() - 86400 * 5 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 86400 * 4 * 1000).toISOString(),
      resolutionStatus: 'RESOLVED',
      claimed: true,
      call: {
        id: '3',
        title: 'SOL will break $100 resistance',
        description: 'Solana price technical analysis',
        outcome: 'NO',
        resolvedAt: new Date(Date.now() - 86400 * 4 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 86400 * 4 * 1000).toISOString(),
        createdAt: new Date(Date.now() - 86400 * 6 * 1000).toISOString(),
        contractAddress: 'CC_SOL_100',
        totalYesStake: 500,
        totalNoStake: 500,
      }
    },
    {
      id: 'stake-4',
      callId: '4',
      userAddress: 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
      amount: 60,
      position: 'YES',
      profitLoss: -60,
      transactionHash: 'tx_hash_4',
      createdAt: new Date(Date.now() - 86400 * 7 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 86400 * 6 * 1000).toISOString(),
      resolutionStatus: 'RESOLVED',
      claimed: false,
      call: {
        id: '4',
        title: 'XLM will hit $0.50 by Tuesday',
        description: 'Stellar Lumens short term pump prediction',
        outcome: 'NO',
        resolvedAt: new Date(Date.now() - 86400 * 6 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 86400 * 6 * 1000).toISOString(),
        createdAt: new Date(Date.now() - 86400 * 8 * 1000).toISOString(),
        contractAddress: 'CC_XLM_50',
        totalYesStake: 1000,
        totalNoStake: 1000,
      }
    }
  ];
}

export const mockStakes = globalForMockDb.mockStakes;

export function getUserStakes(address: string): MockStake[] {
  return mockStakes.filter(s => s.userAddress.toLowerCase() === address.toLowerCase());
}

export function claimStake(address: string, stakeId: string): MockStake {
  const stake = mockStakes.find(
    s => s.id === stakeId && s.userAddress.toLowerCase() === address.toLowerCase()
  );
  if (!stake) {
    throw new Error('Stake not found');
  }
  if (stake.resolutionStatus !== 'RESOLVED' || stake.call.outcome === 'PENDING') {
    throw new Error('Call is not resolved yet');
  }
  if (stake.position !== stake.call.outcome) {
    throw new Error('You did not win this prediction');
  }
  if (stake.claimed) {
    throw new Error('Payout already claimed');
  }
  stake.claimed = true;
  stake.updatedAt = new Date().toISOString();
  return stake;
}
