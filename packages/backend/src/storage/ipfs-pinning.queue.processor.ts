import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { IpfsService, CallContent, OracleEvidence } from './ipfs.service';
import { DeadLetterService } from '../common/queues/dead-letter.service';
import { QUEUE_IPFS_PINNING } from '../common/queues/queues.constants';

export type IpfsPinJob =
  | { type: 'call-content'; content: CallContent }
  | { type: 'oracle-evidence'; evidence: OracleEvidence };

@Processor(QUEUE_IPFS_PINNING)
export class IpfsPinningQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(IpfsPinningQueueProcessor.name);

  constructor(
    private readonly ipfsService: IpfsService,
    private readonly deadLetterService: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<IpfsPinJob>): Promise<{ cid: string }> {
    if (job.data.type === 'call-content') {
      const cid = await this.ipfsService.pinCallContent(job.data.content);
      return { cid };
    }

    const cid = await this.ipfsService.pinOracleEvidence(job.data.evidence);
    return { cid };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<IpfsPinJob>, err: Error) {
    if (!job) return;
    if (!this.deadLetterService.isFinalAttempt(job)) return;
    await this.deadLetterService.moveToDeadLetter(QUEUE_IPFS_PINNING, job);
    this.logger.error(`IPFS pinning job permanently failed`, err.stack);
  }
}
