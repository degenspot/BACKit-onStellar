import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ISender } from './sender.interface';
import { NotificationEntity } from '../../notification.entity';

@Injectable()
export class WebhookSenderService implements ISender {
  private readonly logger = new Logger(WebhookSenderService.name);

  constructor(private readonly httpService: HttpService) {}

  async send(notification: NotificationEntity): Promise<void> {
    this.logger.log(
      `Mock: Dispatching Webhook for notification ${notification.id}`,
    );
    // In a real implementation, you'd fetch the webhook URL from user profile or system settings
    const webhookUrl =
      process.env.NOTIFICATION_WEBHOOK_URL ||
      'http://localhost:8080/webhook-receiver';

    try {
      await firstValueFrom(
        this.httpService.post(webhookUrl, {
          id: notification.id,
          userId: notification.userId,
          type: notification.type,
          message: notification.message,
          referenceId: notification.referenceId,
          createdAt: notification.createdAt,
        }),
      );
      this.logger.log(`Webhook sent successfully to ${webhookUrl}`);
    } catch (error) {
      this.logger.error(
        `Failed to send webhook for notification ${notification.id}: ${error.message}`,
      );
      throw error;
    }
  }
}
