import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WebhookSubscription } from './webhook-subscription.entity';
import { WebhookDeliveryLog, DeliveryStatus } from './webhook-delivery-log.entity';
import { WebhookSignatureService } from './webhook-signature.service';
import { WebhookRateLimiterService } from './webhook-rate-limiter.service';
import {
  WebhookEventType,
  WEBHOOK_EVENT_TYPES,
  WebhookPayload,
} from './webhook-event-types';
import { QUEUE_WEBHOOK_DISPATCH } from '../common/queues/queues.constants';

export interface DeliveryStats {
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  lastDeliveryAt: Date | null;
}

export interface WebhookDispatchJob {
  subscriptionId: string;
  event: WebhookEventType;
  data: Record<string, unknown>;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepo: Repository<WebhookSubscription>,
    @InjectRepository(WebhookDeliveryLog)
    private readonly deliveryLogRepo: Repository<WebhookDeliveryLog>,
    private readonly signatureService: WebhookSignatureService,
    private readonly rateLimiter: WebhookRateLimiterService,
    @InjectQueue(QUEUE_WEBHOOK_DISPATCH)
    private readonly dispatchQueue: Queue,
  ) {}

  // ── Subscription CRUD ─────────────────────────────────────────────────────

  async subscribe(
    userAddress: string,
    url: string,
    events: WebhookEventType[],
  ): Promise<WebhookSubscription> {
    // Validate event types
    const invalidEvents = events.filter(
      (e) => !WEBHOOK_EVENT_TYPES.includes(e),
    );
    if (invalidEvents.length > 0) {
      throw new BadRequestException(
        `Invalid event types: ${invalidEvents.join(', ')}. ` +
          `Valid types: ${WEBHOOK_EVENT_TYPES.join(', ')}`,
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      throw new BadRequestException('Invalid webhook URL');
    }

    // Generate a unique secret for this subscription
    const secret = this.signatureService.generateSecret();

    const subscription = this.subscriptionRepo.create({
      userAddress,
      url,
      secret,
      events,
      isActive: true,
    });

    const saved = await this.subscriptionRepo.save(subscription);
    this.logger.log(
      `Created webhook subscription ${saved.id} for ${userAddress} -> ${url}`,
    );
    return saved;
  }

  async unsubscribe(id: string, userAddress: string): Promise<void> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { id, userAddress },
    });

    if (!subscription) {
      throw new NotFoundException('Webhook subscription not found');
    }

    // Soft delete by marking inactive, or hard delete
    await this.subscriptionRepo.remove(subscription);
    this.logger.log(`Deleted webhook subscription ${id}`);
  }

  async listSubscriptions(userAddress: string): Promise<
    (WebhookSubscription & { deliveryStats: DeliveryStats })[]
  > {
    const subscriptions = await this.subscriptionRepo.find({
      where: { userAddress },
      order: { createdAt: 'DESC' },
    });

    const result = await Promise.all(
      subscriptions.map(async (sub) => {
        const stats = await this.getDeliveryStats(sub.id);
        return { ...sub, deliveryStats: stats };
      }),
    );

    return result;
  }

  async getSubscription(id: string): Promise<WebhookSubscription | null> {
    return this.subscriptionRepo.findOne({ where: { id } });
  }

  private async getDeliveryStats(
    subscriptionId: string,
  ): Promise<DeliveryStats> {
    const [totalDeliveries, successfulDeliveries, failedDeliveries, lastLog] =
      await Promise.all([
        this.deliveryLogRepo.count({
          where: { subscriptionId },
        }),
        this.deliveryLogRepo.count({
          where: { subscriptionId, status: 'success' },
        }),
        this.deliveryLogRepo.count({
          where: { subscriptionId, status: 'failed' },
        }),
        this.deliveryLogRepo.findOne({
          where: { subscriptionId },
          order: { createdAt: 'DESC' },
        }),
      ]);

    return {
      totalDeliveries,
      successfulDeliveries,
      failedDeliveries,
      lastDeliveryAt: lastLog?.createdAt ?? null,
    };
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  /**
   * Enqueue a webhook dispatch for all active subscriptions that listen
   * for the given event type.
   */
  async dispatch(event: WebhookEventType, data: Record<string, unknown>): Promise<number> {
    const subscriptions = await this.subscriptionRepo.find({
      where: { isActive: true },
    });

    const matching = subscriptions.filter((sub) =>
      sub.events.includes(event),
    );

    if (matching.length === 0) {
      this.logger.debug(`No webhook subscribers for event: ${event}`);
      return 0;
    }

    for (const sub of matching) {
      await this.dispatchQueue.add(
        'webhook-dispatch',
        {
          subscriptionId: sub.id,
          event,
          data,
        } satisfies WebhookDispatchJob,
        {
          jobId: `${sub.id}:${event}:${Date.now()}`,
        },
      );
    }

    this.logger.log(
      `Enqueued ${matching.length} webhook dispatch jobs for event: ${event}`,
    );
    return matching.length;
  }

  /**
   * Actually send the webhook payload to the subscriber's URL.
   * This is called by the BullMQ processor.
   */
  async sendWebhook(
    subscription: WebhookSubscription,
    event: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.rateLimiter.isAllowed(subscription.url)) {
      throw new Error(`Rate limited: ${subscription.url}`);
    }

    const payload: Omit<WebhookPayload, 'signature'> = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const payloadStr = JSON.stringify(payload);
    const signature = this.signatureService.signPayload(
      payloadStr,
      subscription.secret,
    );

    const signedPayload: WebhookPayload = {
      ...payload,
      signature,
    };

    const startTime = Date.now();

    try {
      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'User-Agent': 'BACKit-Webhook/1.0',
        },
        body: JSON.stringify(signedPayload),
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        await this.recordDelivery(
          subscription.id,
          event,
          subscription.url,
          'failed',
          1,
          response.status,
          `HTTP ${response.status}: ${response.statusText}`,
          durationMs,
        );
        throw new Error(
          `Webhook returned ${response.status} for ${subscription.id}`,
        );
      }

      await this.recordDelivery(
        subscription.id,
        event,
        subscription.url,
        'success',
        1,
        response.status,
        null,
        durationMs,
      );

      this.logger.debug(
        `Webhook delivered to ${subscription.url} (event: ${event})`,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('Rate limited')) {
        throw err;
      }
      // Re-throw so BullMQ can retry
      throw err;
    }
  }

  /**
   * Send a test ping to a webhook URL to verify connectivity.
   */
  async sendTestPing(
    subscription: WebhookSubscription,
  ): Promise<{ success: boolean; statusCode: number; message: string }> {
    const testPayload: WebhookPayload = {
      event: 'call.created',
      timestamp: new Date().toISOString(),
      data: {
        test: true,
        message: 'This is a test webhook from BACKit.',
      },
      signature: '',
    };

    const payloadStr = JSON.stringify({
      event: testPayload.event,
      timestamp: testPayload.timestamp,
      data: testPayload.data,
    });

    testPayload.signature = this.signatureService.signPayload(
      payloadStr,
      subscription.secret,
    );

    try {
      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': testPayload.signature,
          'User-Agent': 'BACKit-Webhook/1.0',
        },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(10000),
      });

      return {
        success: response.ok,
        statusCode: response.status,
        message: response.ok
          ? 'Test ping sent successfully'
          : `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        statusCode: 0,
        message: `Failed to send test ping: ${message}`,
      };
    }
  }

  // ── Delivery Logging ──────────────────────────────────────────────────────

  private async recordDelivery(
    subscriptionId: string,
    eventType: string,
    targetUrl: string,
    status: DeliveryStatus,
    attemptNumber: number,
    httpStatus: number,
    errorMessage: string | null,
    durationMs: number,
  ): Promise<void> {
    const log = this.deliveryLogRepo.create({
      subscriptionId,
      eventType,
      targetUrl,
      status,
      attemptNumber,
      httpStatus,
      errorMessage,
      durationMs,
    });
    await this.deliveryLogRepo.save(log);
  }

  /**
   * Log a retry delivery attempt from the processor.
   */
  async recordRetryDelivery(
    subscriptionId: string,
    eventType: string,
    targetUrl: string,
    attemptNumber: number,
    httpStatus: number,
    errorMessage: string | null,
    durationMs: number,
  ): Promise<void> {
    await this.recordDelivery(
      subscriptionId,
      eventType,
      targetUrl,
      'failed',
      attemptNumber,
      httpStatus,
      errorMessage,
      durationMs,
    );
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  /**
   * Clean up old delivery logs (older than 30 days) once per day.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanOldDeliveryLogs(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const result = await this.deliveryLogRepo.delete({
      createdAt: LessThan(cutoff),
    });

    this.logger.log(
      `Cleaned up ${result.affected ?? 0} old delivery log entries`,
    );
  }

  /**
   * Clean up stale rate limiter entries every 5 minutes.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanRateLimiter(): Promise<void> {
    this.rateLimiter.cleanup();
  }
}
