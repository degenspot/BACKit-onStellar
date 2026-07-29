/**
 * Webhook event types supported by the dispatch system.
 */
export const WEBHOOK_EVENT_TYPES = [
  'call.created',
  'call.resolved',
  'stake.placed',
  'stake.withdrawn',
  'payout.ready',
  'price.alert.triggered',
  'leaderboard.updated',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * Payload envelope sent to webhook subscribers.
 */
export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
  signature: string;
}
