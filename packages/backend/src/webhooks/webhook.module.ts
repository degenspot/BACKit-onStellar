import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueuesModule } from '../common/queues/queues.module';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WebhookSignatureService } from './webhook-signature.service';
import { WebhookRateLimiterService } from './webhook-rate-limiter.service';
import { WebhookDispatchProcessor } from './webhook-dispatch.processor';
import { WebhookSubscription } from './webhook-subscription.entity';
import { WebhookDeliveryLog } from './webhook-delivery-log.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookSubscription, WebhookDeliveryLog]),
    QueuesModule,
  ],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookSignatureService,
    WebhookRateLimiterService,
    WebhookDispatchProcessor,
  ],
  exports: [WebhookService, WebhookSignatureService],
})
export class WebhookModule {}
