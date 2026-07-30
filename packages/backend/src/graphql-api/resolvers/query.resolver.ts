import { Resolver, Query, Args, Int, registerEnumType } from '@nestjs/graphql';
import { Call } from '../models/call.model';
import { User } from '../models/user.model';
import { LeaderboardEntry, LeaderboardPeriod } from '../models/leaderboard.model';

export enum FeedType {
  FOR_YOU = 'FOR_YOU',
  FOLLOWING = 'FOLLOWING',
  TRENDING = 'TRENDING',
}

registerEnumType(FeedType, {
  name: 'FeedType',
});

@Resolver()
export class QueryResolver {
  
  @Query(() => [Call])
  async calls(
    @Args('filter', { type: () => String, nullable: true }) filter?: string,
    @Args('sort', { type: () => String, nullable: true }) sort?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ): Promise<Call[]> {
    // Implementation goes here
    return [];
  }

  @Query(() => User, { nullable: true })
  async user(@Args('address', { type: () => String }) address: string): Promise<User | null> {
    // Implementation goes here
    return null;
  }

  @Query(() => [Call])
  async feed(@Args('type', { type: () => FeedType }) type: FeedType): Promise<Call[]> {
    // Implementation goes here
    return [];
  }

  @Query(() => [LeaderboardEntry])
  async leaderboard(@Args('period', { type: () => LeaderboardPeriod }) period: LeaderboardPeriod): Promise<LeaderboardEntry[]> {
    // Implementation goes here
    return [];
  }

  @Query(() => [Call]) // Depending on what search returns, could be a union type
  async search(@Args('query', { type: () => String }) query: string): Promise<Call[]> {
    // Implementation goes here
    return [];
  }
}
