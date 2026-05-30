import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { NotificationEntity } from '../notification.entity';
import { ExternalDispatcherService } from './external-dispatcher.service';
import { EmailSenderService } from './senders/email-sender.service';
import { WebhookSenderService } from './senders/webhook-sender.service';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationEntity]), HttpModule],
  providers: [
    ExternalDispatcherService,
    EmailSenderService,
    WebhookSenderService,
  ],
  exports: [ExternalDispatcherService],
})
export class ExternalDispatcherModule {}
