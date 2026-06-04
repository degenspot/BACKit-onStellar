import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { NotificationEntity } from '../notification.entity';
import { ExternalDispatcherService } from './external-dispatcher.service';
import { EmailSenderService } from './senders/email-sender.service';
import { WebhookSenderService } from './senders/webhook-sender.service';
import { QueuesModule } from '../../common/queues/queues.module';
import { NotificationsQueueProcessor } from './notifications.queue.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationEntity]),
    HttpModule,
    QueuesModule,
  ],
  providers: [
    ExternalDispatcherService,
    EmailSenderService,
    WebhookSenderService,
    NotificationsQueueProcessor,
  ],
  exports: [ExternalDispatcherService],
})
export class ExternalDispatcherModule {}
