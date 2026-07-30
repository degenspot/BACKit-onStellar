import { Field, ObjectType, Int, registerEnumType } from '@nestjs/graphql';
import { User } from './user.model';

export enum LeaderboardPeriod {
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  ALL_TIME = 'ALL_TIME',
}

registerEnumType(LeaderboardPeriod, {
  name: 'LeaderboardPeriod',
});

@ObjectType()
export class LeaderboardEntry {
  @Field(() => User)
  user: User;

  @Field(() => Int)
  rank: number;

  @Field(() => Int)
  score: number;
}
