import { Field, ObjectType, ID } from '@nestjs/graphql';
import { Call } from './call.model';

@ObjectType()
export class Bookmark {
  @Field(() => ID)
  id: string;

  @Field()
  userAddress: string;

  @Field()
  callId: string;

  @Field(() => Call)
  call: Call;

  @Field()
  createdAt: Date;
}
