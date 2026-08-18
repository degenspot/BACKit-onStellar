import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhookService } from './webhook.service';
import { WebhookEventType } from './webhook-event-type.enum';

/**
 * Listens to internal EventEmitter events and dispatches corresponding
 * webhook payloads to all active subscribers.
 */
@Injectable()
export class WebhookEventListener {
  private readonly logger = new Logger(WebhookEventListener.name);

  constructor(private readonly webhookService: WebhookService) {}

  @OnEvent('call.created')
  async onCallCreated(data: Record<string, unknown>) {
    await this.dispatch(WebhookEventType.CALL_CREATED, data);
  }

  @OnEvent('call.resolved')
  async onCallResolved(data: Record<string, unknown>) {
    await this.dispatch(WebhookEventType.CALL_RESOLVED, data);
  }

  @OnEvent('stake.placed')
  async onStakePlaced(data: Record<string, unknown>) {
    await this.dispatch(WebhookEventType.STAKE_PLACED, data);
  }

  @OnEvent('stake.withdrawn')
  async onStakeWithdrawn(data: Record<string, unknown>) {
    await this.dispatch(WebhookEventType.STAKE_WITHDRAWN, data);
  }

  @OnEvent('payout.ready')
  async onPayoutReady(data: Record<string, unknown>) {
    await this.dispatch(WebhookEventType.PAYOUT_READY, data);
  }

  @OnEvent('price.alert.triggered')
  async onPriceAlertTriggered(data: Record<string, unknown>) {
    await this.dispatch(WebhookEventType.PRICE_ALERT_TRIGGERED, data);
  }

  @OnEvent('leaderboard.updated')
  async onLeaderboardUpdated(data: Record<string, unknown>) {
    await this.dispatch(WebhookEventType.LEADERBOARD_UPDATED, data);
  }

  private async dispatch(
    event: WebhookEventType,
    data: Record<string, unknown>,
  ) {
    try {
      await this.webhookService.dispatchEvent(event, data);
    } catch (err: any) {
      this.logger.error(
        `Failed to enqueue webhook dispatch for event=${event}: ${err.message}`,
      );
    }
  }
}
