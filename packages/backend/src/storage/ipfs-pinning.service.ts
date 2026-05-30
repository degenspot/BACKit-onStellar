import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_IPFS_PINNING } from '../common/queues/queues.constants';
import { CallContent, OracleEvidence } from './ipfs.service';

@Injectable()
export class IpfsPinningService {
  constructor(
    @InjectQueue(QUEUE_IPFS_PINNING) private readonly ipfsQueue: Queue,
  ) {}

  async pinCallContent(content: CallContent): Promise<{ jobId: string }> {
    const job = await this.ipfsQueue.add('pin-call-content', {
      type: 'call-content',
      content,
    });
    return { jobId: String(job.id) };
  }

  async pinOracleEvidence(evidence: OracleEvidence): Promise<{ jobId: string }> {
    const job = await this.ipfsQueue.add('pin-oracle-evidence', {
      type: 'oracle-evidence',
      evidence,
    });
    return { jobId: String(job.id) };
  }
}

