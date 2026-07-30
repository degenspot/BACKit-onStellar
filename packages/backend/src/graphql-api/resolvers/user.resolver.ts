import { Resolver, ResolveField, Parent } from '@nestjs/graphql';
import { User } from '../models/user.model';
import { DataloaderService } from '../dataloaders/dataloader.service';

@Resolver(() => User)
export class UserResolver {
  constructor(private readonly dataloaders: DataloaderService) {}

  @ResolveField(() => [User])
  async followers(@Parent() user: User): Promise<User[]> {
    return this.dataloaders.userFollowersLoader.load(user.id);
  }

  @ResolveField(() => [User])
  async following(@Parent() user: User): Promise<User[]> {
    return this.dataloaders.userFollowingLoader.load(user.id);
  }
}
