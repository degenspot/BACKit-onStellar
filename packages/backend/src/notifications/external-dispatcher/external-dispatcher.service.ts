import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity } from '../notification.entity';
import { EmailSenderService } from './senders/email-sender.service';
import { WebhookSenderService } from './senders/webhook-sender.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DispatchType } from '../dispatch-type.enum';

@Injectable()
export class ExternalDispatcherService {
  private readonly logger = new Logger(ExternalDispatcherService.name);
  private isProcessing = false;

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationsRepository: Repository<NotificationEntity>,
    private readonly emailSender: EmailSenderService,
    private readonly webhookSender: WebhookSenderService,
  ) {}

  /**
   * Cron job that runs every minute to process un-dispatched notifications.
   * This ensures the main HTTP loop is not blocked.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    if (this.isProcessing) {
      this.logger.verbose(
        'Dispatcher is already processing, skipping this run.',
      );
      return;
    }

    this.isProcessing = true;
    try {
      await this.processPendingNotifications();
    } catch (error) {
      this.logger.error(`Error in dispatcher cron job: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Finds and processes notifications that are pending dispatch.
   */
  async processPendingNotifications() {
    this.logger.verbose('Checking for un-dispatched notifications...');

    const pending = await this.notificationsRepository.find({
      where: {
        isDispatched: false,
      },
      take: 50, // Process in batches
    });

    if (pending.length === 0) {
      return;
    }

    this.logger.log(`Found ${pending.length} notifications to dispatch.`);

    for (const notification of pending) {
      if (notification.dispatchType === DispatchType.NONE) {
        // Should not happen, but if so, mark as dispatched to avoid re-processing
        await this.notificationsRepository.update(notification.id, {
          isDispatched: true,
        });
        continue;
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
        this.logger.verbose(
          `Successfully dispatched notification ${notification.id} via ${notification.dispatchType}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to dispatch notification ${notification.id}: ${error.message}`,
        );
        await this.notificationsRepository.update(notification.id, {
          dispatchError: error.message,
        });
      }
    }
  }
}
