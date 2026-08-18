import {
  IsUrl,
  IsString,
  IsArray,
  ArrayNotEmpty,
  IsEnum,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WebhookEventType } from './webhook-event-type.enum';
import { WebhookDeliveryLog } from './webhook.entity';

// ─── Requests ─────────────────────────────────────────────────────────────────

export class SubscribeWebhookDto {
  @ApiProperty({ description: 'The URL to send event payloads to' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  url: string;

  @ApiProperty({ description: 'HMAC signing secret (min 16 chars)' })
  @IsString()
  @MinLength(16)
  secret: string;

  @ApiProperty({
    enum: WebhookEventType,
    isArray: true,
    description: 'List of event types to subscribe to',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(WebhookEventType, { each: true })
  events: WebhookEventType[];
}

// ─── Responses ────────────────────────────────────────────────────────────────

export class WebhookSubscriptionDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userAddress: string;

  @ApiProperty()
  url: string;

  @ApiProperty({ enum: WebhookEventType, isArray: true })
  events: WebhookEventType[];

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ description: 'Total delivery attempts for this subscription' })
  totalDeliveries: number;

  @ApiProperty({ description: 'Successful delivery count' })
  successfulDeliveries: number;
}

export class WebhookDeliveryLogDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  subscriptionId: string;

  @ApiProperty()
  eventType: string;

  @ApiProperty()
  success: boolean;

  @ApiProperty({ nullable: true })
  statusCode: number | null;

  @ApiProperty({ nullable: true })
  errorMessage: string | null;

  @ApiProperty()
  attempt: number;

  @ApiProperty()
  createdAt: Date;
}

export class TestWebhookResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty({ nullable: true })
  statusCode: number | null;

  @ApiProperty({ nullable: true })
  error: string | null;
}

// ─── Outbound payload ────────────────────────────────────────────────────────

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
  signature: string;
}
