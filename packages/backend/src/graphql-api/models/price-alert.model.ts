import { Field, ObjectType, ID, Float, registerEnumType } from '@nestjs/graphql';

export enum AlertDirection {
  ABOVE = 'ABOVE',
  BELOW = 'BELOW',
}

registerEnumType(AlertDirection, {
  name: 'AlertDirection',
});

@ObjectType()
export class PriceAlert {
  @Field(() => ID)
  id: string;

  @Field()
  userAddress: string;

  @Field()
  callId: string;

  @Field()
  tokenPair: string;

  @Field(() => Float)
  targetPrice: number;

  @Field(() => AlertDirection)
  direction: AlertDirection;

  @Field()
  triggered: boolean;

  @Field()
  createdAt: Date;
}
