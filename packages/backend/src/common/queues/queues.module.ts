import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  QUEUE_DEAD_LETTER,
  QUEUE_IPFS_PINNING,
  QUEUE_NOTIFICATIONS,
  QUEUE_ORACLE_SIGNING,
} from './queues.constants';
import { DeadLetterService } from './dead-letter.service';
import { QueuesStatusService } from './queues.status.service';
import { AdminQueuesController } from './admin-queues.controller';

@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const redisUrl =
          config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        return {
          connection: {
            url: redisUrl,
          },
        };
      },
    }),
    BullModule.registerQueue({
      name: QUEUE_DEAD_LETTER,
    }),
    BullModule.registerQueue({
      name: QUEUE_IPFS_PINNING,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 60 * 60 * 6 },
        removeOnFail: false,
      },
    }),
    BullModule.registerQueue({
      name: QUEUE_NOTIFICATIONS,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 60 * 60 * 24 },
        removeOnFail: false,
      },
    }),
    BullModule.registerQueue({
      name: QUEUE_ORACLE_SIGNING,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: { age: 60 * 60 },
        removeOnFail: false,
      },
    }),
  ],
  controllers: [AdminQueuesController],
  providers: [DeadLetterService, QueuesStatusService],
  exports: [BullModule, DeadLetterService, QueuesStatusService],
})
export class QueuesModule {}
