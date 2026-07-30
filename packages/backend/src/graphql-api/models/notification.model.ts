import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';

export enum NotificationType {
  INFO = 'INFO',
  WARNING = 'WARNING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
}

registerEnumType(NotificationType, {
  name: 'NotificationType',
});

export enum DispatchType {
  NONE = 'NONE',
  EMAIL = 'EMAIL',
  PUSH = 'PUSH',
}

registerEnumType(DispatchType, {
  name: 'DispatchType',
});

@ObjectType()
export class Notification {
  @Field(() => ID)
  id: string;

  @Field()
  userId: string;

  @Field(() => NotificationType)
  type: NotificationType;

  @Field({ nullable: true })
  referenceId?: string;

  @Field()
  message: string;

  @Field()
  readStatus: boolean;

  @Field()
  isDispatched: boolean;

  @Field()
  inApp: boolean;

  @Field(() => DispatchType)
  dispatchType: DispatchType;

  @Field({ nullable: true })
  dispatchError?: string;

  @Field()
  createdAt: Date;
}
