import {
  IsString,
  IsArray,
  IsUrl,
  IsNotEmpty,
  ArrayMinSize,
  ArrayUnique,
  IsIn,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WEBHOOK_EVENT_TYPES, WebhookEventType } from '../webhook-event-types';

export class CreateWebhookSubscriptionDto {
  @ApiProperty({
    description: 'Stellar wallet address of the subscriber',
    example: 'GCVDOU7R6J5H6T3KQ5V2H5Y6L7Q2N6D4P3R2W8X9Z0A1B2C3D4E5F6G7H8',
  })
  @IsString()
  @IsNotEmpty()
  userAddress: string;

  @ApiProperty({
    description: 'Webhook callback URL',
    example: 'https://example.com/webhook-callback',
  })
  @IsUrl({ protocols: ['https', 'http'], require_tld: false })
  @IsNotEmpty()
  url: string;

  @ApiProperty({
    description: 'Array of event types to subscribe to',
    example: ['call.resolved', 'payout.ready'],
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(WEBHOOK_EVENT_TYPES as unknown as string[], { each: true })
  events: WebhookEventType[];
}

export class TestWebhookDto {
  @ApiProperty({
    description: 'Stellar wallet address',
    example: 'GCVDOU7R6J5H6T3KQ5V2H5Y6L7Q2N6D4P3R2W8X9Z0A1B2C3D4E5F6G7H8',
  })
  @IsString()
  @IsNotEmpty()
  userAddress: string;

  @ApiProperty({
    description: 'Webhook URL to test',
    example: 'https://example.com/webhook-callback',
  })
  @IsUrl({ protocols: ['https', 'http'], require_tld: false })
  @IsNotEmpty()
  url: string;

  @ApiProperty({
    description: 'HMAC secret for signing the test payload',
    example: 'abc123secret',
  })
  @IsString()
  @IsNotEmpty()
  secret: string;
}
