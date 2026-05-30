import { Injectable, Logger } from '@nestjs/common';
import { ISender } from './sender.interface';
import { NotificationEntity } from '../../notification.entity';

@Injectable()
export class EmailSenderService implements ISender {
  private readonly logger = new Logger(EmailSenderService.name);

  async send(notification: NotificationEntity): Promise<void> {
    this.logger.log(
      `Mock: Sending Email for notification ${notification.id} to user ${notification.userId}`,
    );
    this.logger.verbose(`Email content: ${notification.message}`);
    // In a real implementation, you'd use a library like `nodemailer` or `sendgrid`
    return Promise.resolve();
  }
}
