import { Injectable, Scope } from '@nestjs/common';
import * as DataLoader from 'dataloader';
import { User } from '../models/user.model';
import { Stake } from '../models/stake.model';
// Assume services exist to fetch these entities by keys.
// In a real implementation, you would inject those services here.

@Injectable({ scope: Scope.REQUEST })
export class DataloaderService {
  constructor() {}

  public readonly userLoader = new DataLoader<string, User>(async (userIds: readonly string[]) => {
    // Mock implementation for N+1 prevention
    // You would use userRepository.findByIds(userIds) here.
    return userIds.map(id => ({ id, walletAddress: 'mock', currentWinStreak: 0, bestWinStreak: 0, banned: false, createdAt: new Date(), updatedAt: new Date(), followers: [], following: [] } as User));
  });

  public readonly callStakesLoader = new DataLoader<string, Stake[]>(async (callIds: readonly string[]) => {
    // Mock implementation
    return callIds.map(id => []);
  });

  public readonly userFollowersLoader = new DataLoader<string, User[]>(async (userIds: readonly string[]) => {
    return userIds.map(id => []);
  });

  public readonly userFollowingLoader = new DataLoader<string, User[]>(async (userIds: readonly string[]) => {
    return userIds.map(id => []);
  });

  public readonly isBookmarkedLoader = new DataLoader<{ callId: string; userAddress: string }, boolean>(
    async (keys: readonly { callId: string; userAddress: string }[]) => {
      return keys.map(() => false);
    }
  );
}
