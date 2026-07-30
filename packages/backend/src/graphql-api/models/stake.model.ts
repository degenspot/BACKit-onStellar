import { Field, ObjectType, ID, Float } from '@nestjs/graphql';

@ObjectType()
export class Stake {
  @Field(() => ID)
  id: string;

  @Field()
  userAddress: string;

  @Field()
  callId: string;

  @Field(() => Float)
  amount: number;

  @Field()
  createdAt: Date;
}
