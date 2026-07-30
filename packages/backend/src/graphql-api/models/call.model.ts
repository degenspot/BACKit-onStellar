import { Field, ObjectType, ID, Int, registerEnumType } from '@nestjs/graphql';
import { User } from './user.model';
import { Stake } from './stake.model';

export enum CallStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  PAUSED = 'PAUSED',
  SETTLING = 'SETTLING',
  RESOLVED_YES = 'RESOLVED_YES',
  RESOLVED_NO = 'RESOLVED_NO',
}

registerEnumType(CallStatus, {
  name: 'CallStatus',
});

@ObjectType()
export class Call {
  @Field(() => ID)
  id: string;

  @Field()
  title: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  creatorAddress: string;

  @Field()
  isHidden: boolean;

  @Field(() => Int)
  reportCount: number;

  @Field(() => CallStatus)
  status: CallStatus;

  @Field({ nullable: true })
  endsAt?: Date;

  @Field({ nullable: true })
  resolvedAt?: Date;

  @Field({ nullable: true })
  finalPrice?: string;

  @Field()
  totalYesStake: string;

  @Field()
  totalNoStake: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  // Field resolvers
  @Field(() => User)
  creator: User;

  @Field(() => [Stake])
  stakes: Stake[];

  @Field()
  isBookmarked: boolean;
}
