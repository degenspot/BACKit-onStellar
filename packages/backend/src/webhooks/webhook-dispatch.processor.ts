import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { WebhookService, WebhookDispatchJob } from './webhook.service';
import { WebhookSubscription } from './webhook-subscription.entity';
import { DeadLetterService } from '../common/queues/dead-letter.service';
import { QUEUE_WEBHOOK_DISPATCH } from '../common/queues/queues.constants';

@Processor(QUEUE_WEBHOOK_DISPATCH)
export class WebhookDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDispatchProcessor.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly deadLetterService: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<WebhookDispatchJob>): Promise<void> {
    const { subscriptionId, event, data } = job.data;

    const subscription = await this.webhookService.getSubscription(
      subscriptionId,
    );

    if (!subscription) {
      this.logger.warn(
        `Webhook subscription ${subscriptionId} not found, skipping job`,
      );
      return;
    }

    if (!subscription.isActive) {
      this.logger.debug(
        `Webhook subscription ${subscriptionId} is inactive, skipping job`,
      );
      return;
    }

    const startTime = Date.now();

    try {
      await this.webhookService.sendWebhook(subscription, event, data);

      this.logger.debug(
        `Webhook dispatched: ${event} -> ${subscription.url} (attempt ${job.attemptsMade + 1})`,
      );
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const isRateLimited =
        err?.message?.startsWith('Rate limited') ?? false;

      // Record the failed attempt
      await this.webhookService.recordRetryDelivery(
        subscriptionId,
        event,
        subscription.url,
        job.attemptsMade + 1,
        err?.status ?? err?.statusCode ?? 0,
        err?.message ?? String(err),
        durationMs,
      );

      if (isRateLimited) {
        // For rate limiting, throw with a small delay hint for backoff
        throw err;
      }

      this.logger.warn(
        `Webhook dispatch failed for ${subscription.id} ` +
          `(attempt ${job.attemptsMade + 1}/${job.opts.attempts}): ${err?.message ?? err}`,
      );

      throw err;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<WebhookDispatchJob>, err: Error) {
    if (!job) return;

    this.logger.error(
      `Webhook dispatch job failed (subscriptionId=${job.data.subscriptionId}, ` +
        `event=${job.data.event}, attempts=${job.attemptsMade})`,
      err.stack,
    );

    if (!this.deadLetterService.isFinalAttempt(job)) return;

    await this.deadLetterService.moveToDeadLetter(
      QUEUE_WEBHOOK_DISPATCH,
      job,
    );

    this.logger.error(
      `Webhook dispatch job moved to dead letter queue ` +
        `(subscriptionId=${job.data.subscriptionId}, event=${job.data.event})`,
    );
  }

  @OnWorkerEvent('completed')
  async onCompleted(job: Job<WebhookDispatchJob>) {
    this.logger.debug(
      `Webhook dispatch job completed (subscriptionId=${job.data.subscriptionId}, ` +
        `event=${job.data.event})`,
    );
  }
}
