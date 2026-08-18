import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WebhookSubscription, WebhookDeliveryLog } from './webhook.entity';
import { WebhookEventType } from './webhook-event-type.enum';
import {
  SubscribeWebhookDto,
  WebhookSubscriptionDto,
  WebhookDeliveryLogDto,
  WebhookPayload,
  TestWebhookResponseDto,
} from './webhook.dto';
import { QUEUE_WEBHOOK_DISPATCH } from './webhook-queue.constants';

export interface DispatchWebhookJob {
  subscriptionId: string;
  event: WebhookEventType;
  data: Record<string, unknown>;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subRepo: Repository<WebhookSubscription>,
    @InjectRepository(WebhookDeliveryLog)
    private readonly logRepo: Repository<WebhookDeliveryLog>,
    @InjectQueue(QUEUE_WEBHOOK_DISPATCH)
    private readonly dispatchQueue: Queue<DispatchWebhookJob>,
    private readonly httpService: HttpService,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async subscribe(
    userAddress: string,
    dto: SubscribeWebhookDto,
  ): Promise<WebhookSubscriptionDto> {
    const sub = this.subRepo.create({
      userAddress,
      url: dto.url,
      secret: dto.secret,
      events: dto.events,
      isActive: true,
    });
    const saved = await this.subRepo.save(sub);
    return this.toDto(saved, 0, 0);
  }

  async unsubscribe(userAddress: string, id: string): Promise<void> {
    const sub = await this.findOwnedOrThrow(userAddress, id);
    await this.subRepo.remove(sub);
  }

  async listSubscriptions(
    userAddress: string,
  ): Promise<WebhookSubscriptionDto[]> {
    const subs = await this.subRepo.find({ where: { userAddress } });

    return Promise.all(
      subs.map(async (sub) => {
        const [total, success] = await Promise.all([
          this.logRepo.count({ where: { subscriptionId: sub.id } }),
          this.logRepo.count({
            where: { subscriptionId: sub.id, success: true },
          }),
        ]);
        return this.toDto(sub, total, success);
      }),
    );
  }

  // ─── Test endpoint ─────────────────────────────────────────────────────────

  async sendTestPing(
    userAddress: string,
    id: string,
  ): Promise<TestWebhookResponseDto> {
    const sub = await this.findOwnedOrThrow(userAddress, id);

    const payload = this.buildPayload(
      WebhookEventType.CALL_CREATED,
      { test: true, message: 'BACKit webhook test ping' },
      sub.secret,
    );

    try {
      const response = await firstValueFrom(
        this.httpService.post(sub.url, payload, { timeout: 5000 }),
      );
      return { success: true, statusCode: response.status, error: null };
    } catch (err: any) {
      const statusCode = err?.response?.status ?? null;
      return { success: false, statusCode, error: err?.message ?? String(err) };
    }
  }

  // ─── Dispatch ──────────────────────────────────────────────────────────────

  /**
   * Enqueue dispatch jobs for all active subscriptions that include this event.
   * Called by the event listener.
   */
  async dispatchEvent(
    event: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<void> {
    const subs = await this.subRepo.find({ where: { isActive: true } });
    const matching = subs.filter((s) => s.events.includes(event));

    if (matching.length === 0) return;

    this.logger.debug(
      `Dispatching event=${event} to ${matching.length} subscriber(s)`,
    );

    await Promise.all(
      matching.map((sub) =>
        this.dispatchQueue.add(
          'dispatch',
          { subscriptionId: sub.id, event, data },
          { jobId: `${sub.id}-${event}-${Date.now()}` },
        ),
      ),
    );
  }

  // ─── HMAC ──────────────────────────────────────────────────────────────────

  static signPayload(body: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  buildPayload(
    event: WebhookEventType,
    data: Record<string, unknown>,
    secret: string,
  ): WebhookPayload {
    const partial = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };
    const body = JSON.stringify(partial);
    const signature = WebhookService.signPayload(body, secret);
    return { ...partial, signature };
  }

  // ─── Delivery tracking ─────────────────────────────────────────────────────

  async recordDelivery(
    subscriptionId: string,
    eventType: string,
    payload: string,
    success: boolean,
    statusCode: number | null,
    errorMessage: string | null,
    attempt: number,
  ): Promise<void> {
    const log = this.logRepo.create({
      subscriptionId,
      eventType,
      payload,
      success,
      statusCode,
      errorMessage,
      attempt,
    });
    await this.logRepo.save(log);
  }

  async getDeliveryLogs(
    userAddress: string,
    subscriptionId: string,
  ): Promise<WebhookDeliveryLogDto[]> {
    // Verify ownership
    await this.findOwnedOrThrow(userAddress, subscriptionId);

    const logs = await this.logRepo.find({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    return logs.map((l) => ({
      id: l.id,
      subscriptionId: l.subscriptionId,
      eventType: l.eventType,
      success: l.success,
      statusCode: l.statusCode,
      errorMessage: l.errorMessage,
      attempt: l.attempt,
      createdAt: l.createdAt,
    }));
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  async findById(id: string): Promise<WebhookSubscription | null> {
    return this.subRepo.findOne({ where: { id } });
  }

  private async findOwnedOrThrow(
    userAddress: string,
    id: string,
  ): Promise<WebhookSubscription> {
    const sub = await this.subRepo.findOne({ where: { id } });
    if (!sub)
      throw new NotFoundException(`Webhook subscription ${id} not found`);
    if (sub.userAddress !== userAddress) {
      throw new ForbiddenException('You do not own this webhook subscription');
    }
    return sub;
  }

  private toDto(
    sub: WebhookSubscription,
    totalDeliveries: number,
    successfulDeliveries: number,
  ): WebhookSubscriptionDto {
    return {
      id: sub.id,
      userAddress: sub.userAddress,
      url: sub.url,
      events: sub.events,
      isActive: sub.isActive,
      createdAt: sub.createdAt,
      totalDeliveries,
      successfulDeliveries,
    };
  }
}
