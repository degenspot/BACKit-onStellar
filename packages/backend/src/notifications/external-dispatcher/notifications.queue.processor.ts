import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import { NotificationEntity } from '../notification.entity';
import { DispatchType } from '../dispatch-type.enum';
import { EmailSenderService } from './senders/email-sender.service';
import { WebhookSenderService } from './senders/webhook-sender.service';
import { DeadLetterService } from '../../common/queues/dead-letter.service';
import { QUEUE_NOTIFICATIONS } from '../../common/queues/queues.constants';

export type DispatchNotificationJob = {
  notificationId: number;
};

@Processor(QUEUE_NOTIFICATIONS)
export class NotificationsQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsQueueProcessor.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationsRepository: Repository<NotificationEntity>,
    private readonly emailSender: EmailSenderService,
    private readonly webhookSender: WebhookSenderService,
    private readonly deadLetterService: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<DispatchNotificationJob>): Promise<void> {
    const notification = await this.notificationsRepository.findOne({
      where: { id: job.data.notificationId },
    });
    if (!notification) {
      this.logger.warn(`Notification ${job.data.notificationId} not found`);
      return;
    }

    if (notification.isDispatched) return;

    if (notification.dispatchType === DispatchType.NONE) {
      await this.notificationsRepository.update(notification.id, {
        isDispatched: true,
        dispatchError: null,
      });
      return;
    }

    try {
      if (notification.dispatchType === DispatchType.EMAIL) {
        await this.emailSender.send(notification);
      } else if (notification.dispatchType === DispatchType.WEBHOOK) {
        await this.webhookSender.send(notification);
      }

      await this.notificationsRepository.update(notification.id, {
        isDispatched: true,
        dispatchError: null,
      });
    } catch (err: any) {
      await this.notificationsRepository.update(notification.id, {
        dispatchError: err?.message ?? String(err),
      });
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<DispatchNotificationJob>, err: Error) {
    if (!job) return;
    if (!this.deadLetterService.isFinalAttempt(job)) return;
    await this.deadLetterService.moveToDeadLetter(QUEUE_NOTIFICATIONS, job);
    this.logger.error(
      `Notification job permanently failed (notificationId=${job.data.notificationId})`,
      err.stack,
    );
  }
}

