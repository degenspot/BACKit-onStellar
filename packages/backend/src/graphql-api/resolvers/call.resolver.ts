import { Resolver, ResolveField, Parent, Context } from '@nestjs/graphql';
import { Call } from '../models/call.model';
import { User } from '../models/user.model';
import { Stake } from '../models/stake.model';
import { DataloaderService } from '../dataloaders/dataloader.service';

@Resolver(() => Call)
export class CallResolver {
  constructor(private readonly dataloaders: DataloaderService) {}

  @ResolveField(() => User)
  async creator(@Parent() call: Call): Promise<User> {
    return this.dataloaders.userLoader.load(call.creatorAddress);
  }

  @ResolveField(() => [Stake])
  async stakes(@Parent() call: Call): Promise<Stake[]> {
    return this.dataloaders.callStakesLoader.load(call.id);
  }

  @ResolveField(() => Boolean)
  async isBookmarked(
    @Parent() call: Call,
    @Context() context: any
  ): Promise<boolean> {
    const userAddress = context.req?.user?.walletAddress;
    if (!userAddress) return false;
    
    return this.dataloaders.isBookmarkedLoader.load({
      callId: call.id,
      userAddress,
    });
  }
}
