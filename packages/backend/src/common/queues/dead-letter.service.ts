import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { QUEUE_DEAD_LETTER, QueueName } from './queues.constants';

export type DeadLetterPayload = {
  sourceQueue: QueueName;
  jobName: string;
  jobId: string | number;
  attemptsMade: number;
  attempts: number;
  failedReason?: string;
  stacktrace?: string[];
  data: unknown;
  movedAt: string;
};

@Injectable()
export class DeadLetterService {
  constructor(@InjectQueue(QUEUE_DEAD_LETTER) private readonly dlq: Queue) {}

  isFinalAttempt(job: Job): boolean {
    const attempts = job.opts.attempts ?? 1;
    return job.attemptsMade >= attempts;
  }

  async moveToDeadLetter(sourceQueue: QueueName, job: Job): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    const payload: DeadLetterPayload = {
      sourceQueue,
      jobName: job.name,
      jobId: job.id ?? '',
      attemptsMade: job.attemptsMade,
      attempts,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace ?? undefined,
      data: job.data,
      movedAt: new Date().toISOString(),
    };

    await this.dlq.add('dead-letter', payload, {
      removeOnComplete: { age: 60 * 60 * 24 * 30 }, // 30 days
      removeOnFail: false,
    });
  }
}
