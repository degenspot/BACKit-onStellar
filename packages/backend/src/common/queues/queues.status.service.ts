import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  QUEUE_DEAD_LETTER,
  QUEUE_IPFS_PINNING,
  QUEUE_NOTIFICATIONS,
  QUEUE_ORACLE_SIGNING,
} from './queues.constants';

async function summarize(queue: Queue) {
  const counts = await queue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'completed',
    'failed',
    'paused',
  );
  return {
    name: queue.name,
    counts,
  };
}

@Injectable()
export class QueuesStatusService {
  constructor(
    @InjectQueue(QUEUE_IPFS_PINNING) private readonly ipfsQueue: Queue,
    @InjectQueue(QUEUE_NOTIFICATIONS)
    private readonly notificationsQueue: Queue,
    @InjectQueue(QUEUE_ORACLE_SIGNING)
    private readonly oracleSigningQueue: Queue,
    @InjectQueue(QUEUE_DEAD_LETTER) private readonly deadLetterQueue: Queue,
  ) {}

  async getStatus() {
    const [ipfs, notifications, oracleSigning, deadLetter] = await Promise.all([
      summarize(this.ipfsQueue),
      summarize(this.notificationsQueue),
      summarize(this.oracleSigningQueue),
      summarize(this.deadLetterQueue),
    ]);

    return {
      queues: [ipfs, notifications, oracleSigning, deadLetter],
    };
  }
}

