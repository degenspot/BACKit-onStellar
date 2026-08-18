import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WebhookService, DispatchWebhookJob } from './webhook.service';
import { QUEUE_WEBHOOK_DISPATCH } from './webhook-queue.constants';

/**
 * Per-URL in-memory rate limiter: max 10 req/s.
 * In production you'd use a Redis-based sliding window,
 * but for a single-instance this is deterministic and testable.
 */
class UrlRateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly maxPerSecond: number;

  constructor(maxPerSecond = 10) {
    this.maxPerSecond = maxPerSecond;
  }

  isAllowed(url: string): boolean {
    const now = Date.now();
    const windowMs = 1000;
    const existing = (this.windows.get(url) ?? []).filter(
      (ts) => now - ts < windowMs,
    );
    if (existing.length >= this.maxPerSecond) return false;
    existing.push(now);
    this.windows.set(url, existing);
    return true;
  }
}

@Processor(QUEUE_WEBHOOK_DISPATCH)
export class WebhookDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDispatchProcessor.name);
  private readonly rateLimiter = new UrlRateLimiter(10);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly httpService: HttpService,
  ) {
    super();
  }

  async process(job: Job<DispatchWebhookJob>): Promise<void> {
    const { subscriptionId, event, data } = job.data;

    const sub = await this.webhookService.findById(subscriptionId);
    if (!sub || !sub.isActive) {
      this.logger.warn(
        `Skipping job for inactive/missing subscription ${subscriptionId}`,
      );
      return;
    }

    // Rate limit check
    if (!this.rateLimiter.isAllowed(sub.url)) {
      this.logger.warn(`Rate limit hit for ${sub.url} — requeueing`);
      throw new Error(`Rate limit exceeded for ${sub.url}`);
    }

    const payload = this.webhookService.buildPayload(event, data, sub.secret);
    const payloadJson = JSON.stringify(payload);

    let statusCode: number | null = null;
    let errorMessage: string | null = null;
    let success = false;

    try {
      const response = await firstValueFrom(
        this.httpService.post(sub.url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-BACKit-Signature': payload.signature,
            'X-BACKit-Event': event,
          },
          timeout: 10_000,
        }),
      );
      statusCode = response.status;
      success = response.status >= 200 && response.status < 300;
      this.logger.log(
        `Webhook delivered: event=${event} sub=${subscriptionId} status=${statusCode}`,
      );
    } catch (err: any) {
      statusCode = err?.response?.status ?? null;
      errorMessage = err?.message ?? String(err);
      this.logger.warn(
        `Webhook delivery failed: event=${event} sub=${subscriptionId} attempt=${job.attemptsMade + 1} error=${errorMessage}`,
      );
      throw err; // re-throw so BullMQ retries
    } finally {
      await this.webhookService.recordDelivery(
        subscriptionId,
        event,
        payloadJson,
        success,
        statusCode,
        errorMessage,
        job.attemptsMade + 1,
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<DispatchWebhookJob>, err: Error) {
    if (!job) return;
    this.logger.error(
      `Webhook job permanently failed: sub=${job.data.subscriptionId} event=${job.data.event}`,
      err.stack,
    );
  }
}
