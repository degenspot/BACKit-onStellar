import { Field, ObjectType, ID, Int } from '@nestjs/graphql';
import { Call } from './call.model';

@ObjectType()
export class User {
  @Field(() => ID)
  id: string;

  @Field()
  walletAddress: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  referralCode?: string;

  @Field({ nullable: true })
  displayName?: string;

  @Field({ nullable: true })
  bio?: string;

  @Field({ nullable: true })
  avatarCid?: string;

  @Field(() => Int)
  currentWinStreak: number;

  @Field(() => Int)
  bestWinStreak: number;

  @Field()
  banned: boolean;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  // Field resolvers
  @Field(() => [User])
  followers: User[];

  @Field(() => [User])
  following: User[];
}
